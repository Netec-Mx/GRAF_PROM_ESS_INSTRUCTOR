# trafico

La clientela de Tianguis Digital. Es un script de [Grafana k6](https://grafana.com/docs/k6/)
que corre todo el tiempo en el contenedor `gpe-k6` y le manda tráfico a la tienda, en prod y en
dev. Sin tráfico no hay gráficos.

No es un microservicio: no tiene API, métricas propias ni pruebas. Es un solo archivo,
`trafico.js`, en JavaScript con módulos ES.

## Qué hace cada cliente

Cada cliente virtual repite sin parar: elige un recorrido, lo hace y vuelve a empezar. Entre
una petición y la siguiente espera de 0.5 a 2 segundos, como una persona.

De cada 100 recorridos, **85 van a prod y 15 a dev**.

| Recorrido | Cuántos | Qué hace |
|---|---|---|
| mirar | 60 % | Lista el catálogo, filtra por una categoría y ve de 1 a 3 productos. 1 de cada 3 veces además busca, y algunas búsquedas no tienen resultado. |
| comprar | 30 % | Mira un poco, crea un pedido de 1 a 4 líneas y, si quedó confirmado (201), lo paga. En dev termina en el pedido, sin pagar. |
| revisar | 10 % | Consulta el estado de uno de sus propios pedidos. |

- **Pedidos rechazados a propósito.** 8 de cada 100 pedidos llevan un sku que no existe y
  otros 7 piden 5000 unidades de un producto. Así hay rechazos por sku inexistente y por falta
  de stock.
- **Método de pago:** tarjeta 60 %, oxxo 25 %, spei 15 %.
- **El reparto es el mismo en prod y en dev.** La única diferencia es que dev no tiene pagos:
  allá el recorrido comprar crea el pedido y termina. En dev hay pedidos confirmados y
  rechazados, pero ninguno pagado.
- **Revisar sin pedidos propios.** Un cliente que todavía no compró en ese ambiente pide la
  lista de pedidos en vez de un pedido.

## Cómo se controla

Con `bin/trafico.sh`, desde la raíz del repo:

```bash
bin/trafico.sh estado
bin/trafico.sh nivel buenfin
bin/trafico.sh pausar
bin/trafico.sh reanudar
```

| Nivel | Clientes | Peticiones por segundo que atienden los servicios |
|---|---|---|
| `bajo` | 2 | cerca de 2 |
| `normal` | 5 | 4.5 |
| `alto` | 20 | 19 |
| `buenfin` | 40 | 38 |

`normal` es el nivel con el que arranca. El tope es 60 clientes. Las tasas de `normal`, `alto`
y `buenfin` están medidas; incluyen las consultas que pedidos le hace a catalogo y pagos a
pedidos por cada compra. La de `bajo` es una estimación.

Por debajo, el script usa el executor `externally-controlled` de k6: no decide cuántos
clientes hay, lo decide quien lo controla desde afuera. `bin/trafico.sh` lo hace con
`docker exec gpe-k6 k6 scale --vus N`, `k6 pause`, `k6 resume` y `k6 status`. k6 no publica
ningún puerto en el host.

## Por qué k6 1.x y no 2.x

La versión está en `infra/.env.example`, variable `K6_VERSION`. Se usa la línea 1.x a
propósito: **k6 2.x eliminó el executor `externally-controlled` y los comandos `k6 scale`,
`k6 pause`, `k6 resume` y `k6 status`.** Con 2.x no hay forma de cambiar el número de clientes
de una prueba que ya está corriendo. La línea 1.x sigue recibiendo versiones.

## Memoria

k6 guarda en memoria cada medición para armar su resumen final, y este script no termina
nunca. Por eso corre con `--summary-mode=disabled` y con un solo umbral, sobre `iterations`:
así k6 solo lleva la cuenta de las iteraciones, que es lo que muestra `bin/trafico.sh estado`,
y su memoria no crece con las horas.

## Probar un cambio en el script

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD/servicios/trafico":/trafico:ro grafana/k6:1.8.2 inspect /trafico/trafico.js
docker restart gpe-k6
```

`inspect` revisa que el script cargue. El contenedor lee el archivo al arrancar, así que un
cambio pide reiniciarlo. `MSYS_NO_PATHCONV=1` solo hace falta en Git Bash de Windows, para que
no convierta `/trafico` en una ruta de Windows.
