package mx.tianguis.pagos;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;

/** Las dependencias apuntan hacia adentro: api e infraestructura, luego aplicacion, luego dominio. */
@AnalyzeClasses(packages = "mx.tianguis.pagos", importOptions = ImportOption.DoNotIncludeTests.class)
class ArquitecturaTest {

    @ArchTest
    static final ArchRule DOMINIO_NO_DEPENDE_DE_SPRING_NI_DE_OPENTELEMETRY = noClasses()
            .that()
            .resideInAPackage("..dominio..")
            .should()
            .dependOnClassesThat()
            .resideInAnyPackage("org.springframework..", "io.opentelemetry..");

    @ArchTest
    static final ArchRule DOMINIO_NO_DEPENDE_DE_LAS_OTRAS_CAPAS = noClasses()
            .that()
            .resideInAPackage("..dominio..")
            .should()
            .dependOnClassesThat()
            .resideInAnyPackage("..aplicacion..", "..infraestructura..", "..api..", "..telemetria..");

    @ArchTest
    static final ArchRule APLICACION_NO_DEPENDE_DE_SPRING_NI_DE_OPENTELEMETRY = noClasses()
            .that()
            .resideInAPackage("..aplicacion..")
            .should()
            .dependOnClassesThat()
            .resideInAnyPackage("org.springframework..", "io.opentelemetry..");

    @ArchTest
    static final ArchRule APLICACION_NO_DEPENDE_DE_LOS_ADAPTADORES = noClasses()
            .that()
            .resideInAPackage("..aplicacion..")
            .should()
            .dependOnClassesThat()
            .resideInAnyPackage("..infraestructura..", "..api..", "..telemetria..");
}
