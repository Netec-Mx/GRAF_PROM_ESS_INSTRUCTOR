package mx.tianguis.pagos.dominio;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;

class DominioTest {

    @Test
    void elMontoSeLeeDelTextoSinPerderDecimales() {
        assertThat(Montos.desdeTexto("275.50")).isEqualTo(new BigDecimal("275.50"));
        assertThat(Montos.aTexto(Montos.desdeTexto("89.00"))).isEqualTo("89.00");
        assertThat(Montos.aTexto(Montos.desdeTexto("0.10"))).isEqualTo("0.10");
    }

    @Test
    void laSumaDeMontosEsExacta() {
        // Con double, 0.10 + 0.20 da 0.30000000000000004.
        BigDecimal suma = Montos.desdeTexto("0.10").add(Montos.desdeTexto("0.20"));

        assertThat(Montos.aTexto(suma)).isEqualTo("0.30");
    }

    @ParameterizedTest
    @NullSource
    @ValueSource(strings = {"", "89", "89.0", "89.000", "89,00", "-1.00", "1e3", " 89.00", "abc", "1234567890123.00"})
    void unMontoSinDosDecimalesExactosSeRechaza(String texto) {
        assertThatThrownBy(() -> Montos.desdeTexto(texto)).isInstanceOf(MontoInvalidoException.class);
    }

    @Test
    void losMetodosSeBuscanPorSuCodigoExacto() {
        assertThat(MetodoPago.desdeCodigo("tarjeta")).contains(MetodoPago.TARJETA);
        assertThat(MetodoPago.desdeCodigo("oxxo")).contains(MetodoPago.OXXO);
        assertThat(MetodoPago.desdeCodigo("spei")).contains(MetodoPago.SPEI);
        assertThat(MetodoPago.desdeCodigo("TARJETA")).isEmpty();
        assertThat(MetodoPago.desdeCodigo("bitcoin")).isEmpty();
        assertThat(MetodoPago.desdeCodigo(null)).isEmpty();
    }

    @Test
    void unPagoExigeUnMontoConDosDecimalesYNoNegativo() {
        Pago pago = new Pago("PAG-000001", "PED-000001", new BigDecimal("10.00"), MetodoPago.SPEI, EstadoPago.APROBADO, "2026-10-12T00:50:29Z");

        assertThat(pago.aprobado()).isTrue();
        assertThat(new Pago("PAG-000002", "PED-000001", new BigDecimal("10.00"), MetodoPago.SPEI, EstadoPago.RECHAZADO, "2026-10-12T00:50:29Z")
                        .aprobado())
                .isFalse();
        assertThatThrownBy(() -> new Pago("PAG-1", "PED-1", new BigDecimal("10.5"), MetodoPago.SPEI, EstadoPago.APROBADO, "2026-10-12T00:50:29Z"))
                .isInstanceOf(MontoInvalidoException.class);
        assertThatThrownBy(() -> new Pago("PAG-1", "PED-1", new BigDecimal("-1.00"), MetodoPago.SPEI, EstadoPago.APROBADO, "2026-10-12T00:50:29Z"))
                .isInstanceOf(MontoInvalidoException.class);
        assertThatThrownBy(() -> new Pago(null, "PED-1", new BigDecimal("1.00"), MetodoPago.SPEI, EstadoPago.APROBADO, "2026-10-12T00:50:29Z"))
                .isInstanceOf(NullPointerException.class);
    }

    @Test
    void losCodigosDeEstadoSonLosDeLaApi() {
        assertThat(EstadoPago.APROBADO.codigo()).isEqualTo("aprobado");
        assertThat(EstadoPago.RECHAZADO.codigo()).isEqualTo("rechazado");
        assertThat(EstadoPago.ERROR_PASARELA.codigo()).isEqualTo("error_pasarela");
    }
}
