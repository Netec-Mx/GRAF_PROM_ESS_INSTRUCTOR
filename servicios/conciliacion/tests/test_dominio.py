from decimal import Decimal

from conciliacion.dominio import Pago, Pedido, Resultado, conciliar

HOY = "2026-10-12T03:00:00Z"
AYER = "2026-10-11T03:00:00Z"


def pedido(numero: int, total: str, creado_en: str = HOY) -> Pedido:
    return Pedido(id=f"PED-{numero:06d}", creado_en=creado_en, total=Decimal(total))


def pago(
    numero: int, de_pedido: int, monto: str, estado: str = "aprobado", pedido_creado_en: str = HOY
) -> Pago:
    return Pago(
        id=f"PAG-{numero:06d}",
        pedido_id=f"PED-{de_pedido:06d}",
        pedido_creado_en=pedido_creado_en,
        monto=Decimal(monto),
        estado=estado,
    )


def test_todo_cuadrado() -> None:
    pedidos = [pedido(1, "275.50"), pedido(2, "89.00")]
    pagos = [pago(1, 1, "275.50"), pago(2, 2, "89.00")]

    assert conciliar(pedidos, pagos) == Resultado(
        pedidos_revisados=2,
        pedidos_sin_pago=0,
        montos_distintos=0,
        monto_aprobado=Decimal("364.50"),
    )


def test_pedido_sin_pago() -> None:
    pedidos = [pedido(1, "275.50"), pedido(2, "89.00"), pedido(3, "42.00")]
    pagos = [pago(1, 1, "275.50")]

    resultado = conciliar(pedidos, pagos)

    assert resultado.pedidos_revisados == 3
    assert resultado.pedidos_sin_pago == 2
    assert resultado.montos_distintos == 0


def test_pago_con_monto_distinto_al_total_del_pedido() -> None:
    pedidos = [pedido(1, "275.50"), pedido(2, "89.00")]
    pagos = [pago(1, 1, "275.49"), pago(2, 2, "89.00")]

    resultado = conciliar(pedidos, pagos)

    assert resultado.montos_distintos == 1
    # El pedido tiene un pago aprobado, aunque por otro monto: no cuenta como sin pago.
    assert resultado.pedidos_sin_pago == 0


def test_un_pago_rechazado_o_con_error_no_paga_el_pedido() -> None:
    pedidos = [pedido(1, "100.00"), pedido(2, "50.00")]
    pagos = [
        pago(1, 1, "100.00", estado="rechazado"),
        pago(2, 1, "100.00", estado="error_pasarela"),
        pago(3, 2, "50.00", estado="rechazado"),
        pago(4, 2, "50.00"),
    ]

    resultado = conciliar(pedidos, pagos)

    assert resultado.pedidos_sin_pago == 1
    assert resultado.monto_aprobado == Decimal("50.00")
    # Un pago que no está aprobado tampoco se compara con el total.
    assert resultado.montos_distintos == 0


def test_la_suma_del_monto_aprobado_es_exacta() -> None:
    # Con float, 0.10 + 0.20 da 0.30000000000000004.
    pedidos = [pedido(1, "0.10"), pedido(2, "0.20"), pedido(3, "33.33")]
    pagos = [pago(1, 1, "0.10"), pago(2, 2, "0.20"), pago(3, 3, "33.33")]

    resultado = conciliar(pedidos, pagos)

    assert resultado.monto_aprobado == Decimal("33.63")
    assert str(resultado.monto_aprobado) == "33.63"


def test_un_pago_de_un_pedido_que_no_esta_entre_los_confirmados_suma_pero_no_se_compara() -> None:
    pedidos = [pedido(1, "10.00")]
    pagos = [pago(1, 1, "10.00"), pago(2, 99, "500.00")]

    resultado = conciliar(pedidos, pagos)

    assert resultado.montos_distintos == 0
    assert resultado.pedidos_sin_pago == 0
    assert resultado.monto_aprobado == Decimal("510.00")


def test_un_pago_viejo_no_paga_a_un_pedido_nuevo_con_el_mismo_id() -> None:
    """pedidos se reinició y volvió a numerar: PED-000001 de hoy no es el PED-000001 de ayer."""
    pedidos = [pedido(1, "275.50", creado_en=HOY), pedido(2, "89.00", creado_en=HOY)]
    pagos = [
        # Pago del PED-000001 de ayer, que ya no existe. Por otro monto, además.
        pago(1, 1, "42.00", pedido_creado_en=AYER),
        # Pago del PED-000002 de hoy.
        pago(2, 2, "89.00", pedido_creado_en=HOY),
    ]

    resultado = conciliar(pedidos, pagos)

    # El PED-000001 de hoy sigue sin pago: el pago viejo no es suyo.
    assert resultado.pedidos_sin_pago == 1
    # Y el monto distinto no se cuenta: ese pago no se compara con un pedido que no es el suyo.
    assert resultado.montos_distintos == 0
    assert resultado.pedidos_revisados == 2
    # El dinero del pago viejo sí se cobró, así que suma.
    assert resultado.monto_aprobado == Decimal("131.00")


def test_el_mismo_id_y_la_misma_fecha_si_se_emparejan() -> None:
    resultado = conciliar(
        [pedido(1, "275.50", creado_en=AYER)], [pago(1, 1, "275.49", pedido_creado_en=AYER)]
    )

    assert resultado.pedidos_sin_pago == 0
    assert resultado.montos_distintos == 1


def test_sin_pedidos_ni_pagos() -> None:
    assert conciliar([], []) == Resultado(0, 0, 0, Decimal("0.00"))
    assert str(conciliar([], []).monto_aprobado) == "0.00"
