import http.client
import socket
import threading
from collections.abc import Iterator
from decimal import Decimal

import pytest

from conciliacion.aplicacion import DependenciaNoDisponibleError
from conciliacion.dominio import Pago, Pedido
from conciliacion.infraestructura.clientes_http import ClientePagos, ClientePedidos
from tests.servidor import Servidor, levantar


@pytest.fixture
def servicio() -> Iterator[Servidor]:
    with levantar() as servidor:
        yield servidor


CONFIRMADOS = "/pedidos?estado=confirmado"


def test_pedidos_confirmados_con_su_total_como_decimal(servicio: Servidor) -> None:
    servicio.responder(
        CONFIRMADOS,
        {
            "total": 2,
            "pedidos": [
                {
                    "id": "PED-000001",
                    "estado": "confirmado",
                    "lineas": [],
                    "total_mxn": "275.50",
                    "creado_en": "2026-10-12T03:00:00Z",
                },
                {
                    "id": "PED-000002",
                    "estado": "confirmado",
                    "lineas": [],
                    "total_mxn": "0.10",
                    "creado_en": "2026-10-12T03:00:01Z",
                },
            ],
        },
    )

    pedidos = ClientePedidos(servicio.url, 2.0).confirmados()

    assert pedidos == [
        Pedido("PED-000001", "2026-10-12T03:00:00Z", Decimal("275.50")),
        Pedido("PED-000002", "2026-10-12T03:00:01Z", Decimal("0.10")),
    ]
    assert servicio.peticiones == [("GET", CONFIRMADOS, "")]


def test_pagos_con_su_monto_como_decimal(servicio: Servidor) -> None:
    servicio.responder(
        "/pagos",
        {
            "total": 2,
            "pagos": [
                {
                    "id": "PAG-000001",
                    "pedido_id": "PED-000001",
                    "pedido_creado_en": "2026-10-12T03:00:00Z",
                    "monto_mxn": "275.50",
                    "metodo": "tarjeta",
                    "estado": "aprobado",
                },
                {
                    "id": "PAG-000002",
                    "pedido_id": "PED-000002",
                    "pedido_creado_en": "2026-10-12T03:00:01Z",
                    "monto_mxn": "89.00",
                    "metodo": "spei",
                    "estado": "rechazado",
                },
            ],
        },
    )

    pagos = ClientePagos(servicio.url + "/", 2.0).todos()

    assert pagos == [
        Pago("PAG-000001", "PED-000001", "2026-10-12T03:00:00Z", Decimal("275.50"), "aprobado"),
        Pago("PAG-000002", "PED-000002", "2026-10-12T03:00:01Z", Decimal("89.00"), "rechazado"),
    ]
    assert pagos[0].aprobado
    assert not pagos[1].aprobado


def test_listas_vacias(servicio: Servidor) -> None:
    servicio.responder(CONFIRMADOS, {"total": 0, "pedidos": []})
    servicio.responder("/pagos", {"total": 0, "pagos": []})

    assert ClientePedidos(servicio.url, 2.0).confirmados() == []
    assert ClientePagos(servicio.url, 2.0).todos() == []


def _pedido(**cambios: object) -> dict[str, object]:
    """Un pedido bien formado, con los cambios que la prueba quiera romper."""
    return {
        "id": "PED-000001",
        "total_mxn": "275.50",
        "creado_en": "2026-10-12T03:00:00Z",
    } | cambios


@pytest.mark.parametrize(
    ("cuerpo", "codigo"),
    [
        ({"error": "interno"}, 500),
        ({"error": "no encontrado"}, 404),
        ({}, 302),
        (b"esto no es json", 200),
        ([1, 2, 3], 200),
        ({"total": 1}, 200),
        ({"total": 1, "pedidos": "muchos"}, 200),
        ({"total": 1, "pedidos": [7]}, 200),
        ({"total": 1, "pedidos": [{"id": "PED-000001"}]}, 200),
        ({"total": 1, "pedidos": [_pedido(total_mxn=275.5)]}, 200),
        ({"total": 1, "pedidos": [_pedido(total_mxn="275.5")]}, 200),
        ({"total": 1, "pedidos": [_pedido(total_mxn="NaN")]}, 200),
        ({"total": 1, "pedidos": [_pedido(id="")]}, 200),
        ({"total": 1, "pedidos": [_pedido(creado_en=None)]}, 200),
    ],
)
def test_una_respuesta_que_no_sirve_es_dependencia_no_disponible(
    servicio: Servidor, cuerpo: object, codigo: int
) -> None:
    servicio.responder(CONFIRMADOS, cuerpo, codigo)

    with pytest.raises(DependenciaNoDisponibleError, match="pedidos"):
        ClientePedidos(servicio.url, 2.0).confirmados()


@pytest.mark.parametrize(
    "cuerpo",
    [
        # Dice que hay 5 y no trae ninguno: respuesta truncada o mal armada.
        {"total": 5, "pedidos": []},
        {"total": 0, "pedidos": [_pedido()]},
        {"total": 2, "pedidos": [_pedido()]},
        {"pedidos": [_pedido()]},
        {"total": "1", "pedidos": [_pedido()]},
        {"total": 1.0, "pedidos": [_pedido()]},
        {"total": True, "pedidos": [_pedido()]},
        {"total": None, "pedidos": []},
    ],
)
def test_si_total_no_es_un_entero_igual_al_largo_de_la_lista_la_respuesta_no_sirve(
    servicio: Servidor, cuerpo: object
) -> None:
    servicio.responder(CONFIRMADOS, cuerpo)

    with pytest.raises(DependenciaNoDisponibleError, match="respuesta inválida de pedidos: total"):
        ClientePedidos(servicio.url, 2.0).confirmados()


def test_total_tambien_se_exige_en_pagos(servicio: Servidor) -> None:
    servicio.responder("/pagos", {"total": 3, "pagos": []})

    with pytest.raises(DependenciaNoDisponibleError, match="total dice 3 y la lista pagos trae 0"):
        ClientePagos(servicio.url, 2.0).todos()


def test_una_respuesta_que_no_es_http_valido_es_dependencia_no_disponible() -> None:
    """Una cabecera de más de 64 KB hace que http.client lance LineTooLong, que es una
    HTTPException y no un OSError. Antes se escapaba sin capturar."""
    receptor = socket.socket()
    receptor.bind(("127.0.0.1", 0))
    receptor.listen(1)
    respuesta = b"HTTP/1.1 200 OK\r\nX-Relleno: " + b"a" * 70_000 + b"\r\n\r\n{}"

    def atender() -> None:
        conexion, _ = receptor.accept()
        with conexion:
            conexion.recv(4096)
            conexion.sendall(respuesta)

    hilo = threading.Thread(target=atender, daemon=True)
    hilo.start()
    try:
        with pytest.raises(DependenciaNoDisponibleError, match="LineTooLong") as capturado:
            ClientePedidos(f"http://127.0.0.1:{receptor.getsockname()[1]}", 2.0).confirmados()
    finally:
        hilo.join(timeout=5)
        receptor.close()

    assert isinstance(capturado.value.__cause__, http.client.HTTPException)


def test_sin_nadie_escuchando_es_dependencia_no_disponible() -> None:
    with pytest.raises(DependenciaNoDisponibleError, match="pagos no respondió bien"):
        ClientePagos("http://127.0.0.1:1", 1.0).todos()


@pytest.mark.parametrize("url", ["", "pedidos:8080", "ftp://pedidos", "http://"])
def test_una_url_invalida_se_rechaza_al_armar_el_cliente(url: str) -> None:
    with pytest.raises(ValueError, match="URL de pedidos inválida"):
        ClientePedidos(url, 1.0)
