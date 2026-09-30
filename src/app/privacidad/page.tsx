import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Aviso de Privacidad',
  description:
    'Aviso de privacidad integral de InvestTracker: qué datos personales tratamos, para qué, con quién los compartimos y cómo ejercer tus derechos ARCO.',
  // A legal notice should not be indexed as a stale copy, but it must be
  // reachable: indexable, and always served fresh from this route.
  alternates: { canonical: 'https://project-tri0w.vercel.app/privacidad' },
}

/**
 * Aviso de privacidad integral, redactado conforme a la Ley Federal de
 * Protección de Datos Personales en Posesión de los Particulares (LFPDPPP).
 *
 * Por qué la LFPDPPP y no la ley estatal: la Universidad Politécnica de Pachuca
 * es un sujeto obligado, y su propio aviso se funda en la Ley de Protección de
 * Datos Personales en Posesión de Sujetos Obligados para el Estado de Hidalgo.
 * InvestTracker no lo es: opera en cuentas personales del equipo (Vercel y
 * Supabase), de modo que el responsable son las personas físicas que lo operan
 * y la ley aplicable es la federal del sector privado. La UPP aparece aquí como
 * marco académico del proyecto, nunca como responsable del tratamiento.
 *
 * Esta ruta es de primer nivel a propósito: el gating de sesión vive en
 * (app)/layout.tsx, así que el aviso se lee sin cuenta — que es el requisito
 * real, porque debe estar disponible ANTES de que alguien entregue sus datos.
 *
 * Se escribe solo en español. Es un documento jurídico de una jurisdicción
 * concreta y una traducción paralela sería otro texto que podría divergir del
 * que obliga.
 */

/** Fecha que el propio aviso declara. Actualizar al cambiar el texto. */
const ULTIMA_ACTUALIZACION = '30 de septiembre de 2026'

const RESPONSABLES = [
  'Diego Gael Anguiano Samaniego',
  'Rolando Angello Brito González',
  'Gerardo Hernández Estrada',
]

/**
 * Domicilio para oír y recibir notificaciones (art. 16, fracción I LFPDPPP).
 *
 * Es el campus de la Universidad Politécnica de Pachuca, transcrito literalmente
 * del aviso de privacidad institucional para alumnado que la propia UPP publica
 * (última actualización 13/07/2023) — no de la página índice, que omite "Rancho
 * Luna". Se usa porque es donde los responsables son localizables como
 * estudiantes del programa; no convierte a la Universidad en responsable del
 * tratamiento, y la sección 1 lo dice expresamente.
 */
const DOMICILIO =
  'Carretera Pachuca – Cd. Sahagún, km 20, Ex Hacienda de Santa Bárbara, Rancho Luna, Zempoala, Hidalgo, C. P. 43830'

/** Buzón único para solicitudes ARCO y cualquier asunto de privacidad. */
const CORREO_PRIVACIDAD = 'rolandobrito1105@micorreo.upp.edu.mx'

/** El buzón de la sección 1, como enlace accionable donde se le menciona. */
function CorreoPrivacidad() {
  return (
    <a
      href={`mailto:${CORREO_PRIVACIDAD}`}
      className="break-all font-mono text-[0.9em] text-primary underline underline-offset-4"
    >
      {CORREO_PRIVACIDAD}
    </a>
  )
}

const SECCIONES = [
  ['1', 'Quién es el responsable de tus datos'],
  ['2', 'Qué datos personales tratamos'],
  ['3', 'Para qué los usamos'],
  ['4', 'Finalidades a las que puedes negarte'],
  ['5', 'Quién más interviene y dónde se almacenan'],
  ['6', 'Tus derechos ARCO y cómo ejercerlos'],
  ['7', 'Revocar tu consentimiento'],
  ['8', 'Cookies y tecnologías de rastreo'],
  ['9', 'Cambios a este aviso'],
  ['10', 'Naturaleza académica del proyecto'],
] as const

function H2({ id, n, children }: { id: string; n: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      className="mt-12 scroll-mt-6 border-b border-border pb-2 font-serif text-2xl font-bold text-foreground"
    >
      <span className="mr-2 font-mono text-base font-normal text-muted-foreground">{n}</span>
      {children}
    </h2>
  )
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-6 font-semibold text-foreground">{children}</h3>
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 leading-relaxed text-muted-foreground">{children}</p>
}

function UL({ children }: { children: React.ReactNode }) {
  return <ul className="mt-3 space-y-2 pl-5 text-muted-foreground [&>li]:list-disc [&>li]:leading-relaxed">{children}</ul>
}

/** Un término definido por la ley, para que el lector lo reconozca como tal. */
function T({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-foreground">{children}</strong>
}

export default function AvisoDePrivacidadPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <nav className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link href="/" className="font-bold text-foreground">
            InvestTracker
          </Link>
          <Link
            href="/register"
            className="text-sm text-primary underline underline-offset-4"
          >
            Crear cuenta
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="font-serif text-4xl font-bold tracking-tight text-foreground">
          Aviso de Privacidad
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Aviso de privacidad integral · Última actualización: {ULTIMA_ACTUALIZACION}
        </p>

        <p className="mt-6 leading-relaxed text-muted-foreground">
          Este aviso explica qué datos personales recabamos en InvestTracker, para qué los
          usamos, con quién los compartimos y cómo puedes controlarlos. Está redactado
          conforme a la <T>Ley Federal de Protección de Datos Personales en Posesión de los
          Particulares</T> (LFPDPPP), su Reglamento y los Lineamientos del Aviso de Privacidad.
        </p>

        {/* Índice */}
        <nav aria-label="Contenido" className="mt-8 rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">Contenido</h2>
          <ol className="mt-3 space-y-1.5">
            {SECCIONES.map(([n, titulo]) => (
              <li key={n} className="text-sm">
                <a
                  href={`#s${n}`}
                  className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  <span className="mr-2 font-mono text-xs">{n}</span>
                  {titulo}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {/* 1 */}
        <H2 id="s1" n="1">Quién es el responsable de tus datos</H2>
        <P>
          Los <T>responsables</T> del tratamiento de tus datos personales son, de manera
          conjunta, las siguientes personas físicas:
        </P>
        <UL>
          {RESPONSABLES.map(nombre => (
            <li key={nombre}>{nombre}</li>
          ))}
        </UL>
        <P>
          <T>Domicilio para oír y recibir notificaciones:</T> {DOMICILIO}. Corresponde al campus
          de la Universidad Politécnica de Pachuca, donde los responsables son localizables
          como estudiantes del programa de Ingeniería Financiera.
        </P>
        <P>
          <T>Correo electrónico para asuntos de privacidad y solicitudes ARCO:</T>{' '}
          <CorreoPrivacidad />
        </P>
        <P>
          InvestTracker es un proyecto académico desarrollado en el programa de{' '}
          <T>Ingeniería Financiera</T> de la <T>Universidad Politécnica de Pachuca</T>, bajo
          la asesoría del Dr. Omar Santillán Díaz. La Universidad Politécnica de Pachuca{' '}
          <T>no es responsable</T> del tratamiento de los datos personales que se recaban en
          esta plataforma: la UPP cuenta con sus propios avisos de privacidad, publicados en{' '}
          <a
            href="https://www.upp.edu.mx/normatividad/aviso_de_privacidad.php"
            className="text-primary underline underline-offset-4"
            target="_blank"
            rel="noopener noreferrer"
          >
            upp.edu.mx/normatividad
          </a>
          , que rigen el tratamiento que ella realiza de los datos de su comunidad y que son
          independientes de este aviso.
        </P>

        {/* 2 */}
        <H2 id="s2" n="2">Qué datos personales tratamos</H2>

        <H3>Datos de identificación y contacto</H3>
        <UL>
          <li>Correo electrónico.</li>
          <li>
            Contraseña, que se almacena siempre <T>cifrada</T> mediante el servicio de
            autenticación y a la que no tenemos acceso en claro.
          </li>
          <li>Nombre o nombre para mostrar.</li>
        </UL>

        <H3>Datos de perfil (opcionales, los proporcionas tú)</H3>
        <UL>
          <li>Nombre de usuario, biografía, ubicación declarada, sitio web y fotografía de perfil.</li>
          <li>Preferencias de moneda base y de tema visual.</li>
        </UL>

        <H3>Datos patrimoniales y financieros</H3>
        <P>
          Para que la plataforma funcione tratamos datos que la ley clasifica como{' '}
          <T>patrimoniales o financieros</T>:
        </P>
        <UL>
          <li>Los portafolios que creas, con su nombre, descripción y moneda.</li>
          <li>
            Tus posiciones: instrumento, tipo de activo, cantidad, costo promedio y moneda.
          </li>
          <li>
            Tus transacciones: tipo de operación, cantidad, precio, comisiones, fecha de
            ejecución y las <T>notas de texto libre</T> que tú escribas en ellas.
          </li>
          <li>Tus listas de seguimiento y las alertas que configures.</li>
        </UL>
        <P>
          Conforme al artículo 8 de la LFPDPPP, el tratamiento de datos patrimoniales o
          financieros requiere tu <T>consentimiento expreso</T>. Al crear una cuenta y
          registrar información en la plataforma otorgas ese consentimiento para las
          finalidades primarias de la sección 3.
        </P>

        <H3>Datos de uso, seguridad y auditoría</H3>
        <UL>
          <li>
            Registro de tus acciones sobre tus propios datos: qué cambió, cuándo, y el valor
            anterior y el nuevo. Existe para que puedas saber por qué una cifra tuya se movió.
          </li>
          <li>
            Eventos de uso de la plataforma, asociados a tu identificador interno de usuario y
            nunca a tu correo ni a tu nombre.
          </li>
          <li>Notificaciones generadas para ti y su estado de lectura.</li>
          <li>
            Datos técnicos de las solicitudes que tu navegador hace al servidor, incluida tu
            dirección IP, tratados por nuestros proveedores de hospedaje con fines de
            seguridad y diagnóstico de errores.
          </li>
        </UL>

        <H3>Datos que tú decides hacer públicos</H3>
        <UL>
          <li>
            Tu perfil público y tus relaciones de seguimiento, si usas las funciones sociales.
          </li>
          <li>
            Los portafolios que marques como <T>públicos</T> o que compartas mediante un
            enlace con token. Mientras un portafolio esté público o compartido, la información
            que hayas elegido mostrar en él es visible para quien acceda, dentro o fuera de la
            plataforma. Puedes revertirlo en cualquier momento desde{' '}
            <span className="font-mono text-sm">Configuración › Privacidad</span>.
          </li>
        </UL>

        <div className="mt-6 rounded-xl border border-border bg-card p-5">
          <p className="font-semibold text-foreground">No recabamos datos sensibles</p>
          <p className="mt-2 leading-relaxed text-muted-foreground">
            No tratamos ninguno de los datos que el artículo 3, fracción VI de la LFPDPPP
            define como <T>sensibles</T>: origen racial o étnico, estado de salud, información
            genética, creencias religiosas, filosóficas o morales, afiliación sindical,
            opiniones políticas ni preferencia sexual. Tampoco pedimos CURP, RFC, número de
            seguridad social, domicilio, teléfono ni identificación oficial. No solicitamos ni
            almacenamos credenciales de acceso a casas de bolsa, cuentas bancarias o tarjetas,
            y la plataforma <T>no ejecuta operaciones ni custodia dinero</T>.
          </p>
        </div>

        {/* 3 */}
        <H2 id="s3" n="3">Para qué los usamos</H2>
        <P>
          Las siguientes son <T>finalidades primarias</T>: son necesarias para prestarte el
          servicio y no podemos dejar de tratarlas mientras tengas una cuenta activa.
        </P>
        <UL>
          <li>Crear, autenticar y administrar tu cuenta.</li>
          <li>Guardar y mostrar tus portafolios, posiciones y transacciones.</li>
          <li>
            Calcular las métricas que la plataforma ofrece —rendimiento, distribución de
            activos, riesgo, rendimientos ponderados por tiempo y por dinero, simulaciones de
            escenarios y comparación contra un índice de referencia— a partir de los datos que
            registras.
          </li>
          <li>Generar y entregarte las alertas y notificaciones que tú configures.</li>
          <li>
            Mantener un registro de auditoría de los cambios sobre tus datos, para poder
            explicarte el origen de una cifra y para detectar y prevenir accesos indebidos.
          </li>
          <li>Atender tus solicitudes de soporte y las de ejercicio de derechos ARCO.</li>
          <li>Cumplir requerimientos legales de autoridad competente.</li>
        </UL>

        {/* 4 */}
        <H2 id="s4" n="4">Finalidades a las que puedes negarte</H2>
        <P>
          Las siguientes son <T>finalidades secundarias</T>: no son necesarias para el
          servicio, y puedes oponerte a ellas sin que eso afecte tu uso de la plataforma.
        </P>
        <UL>
          <li>
            <T>Analítica de producto.</T> Medir qué partes de la plataforma se usan y dónde se
            atoran las personas, para mejorarla.
          </li>
          <li>
            <T>Funciones sociales.</T> Perfil público, seguidores y tablas comparativas entre
            usuarios.
          </li>
          <li>
            <T>Uso académico.</T> Presentar el proyecto en foros académicos y de divulgación,
            entre ellos <T>ExpoCiencias Hidalgo 2026</T> (folio HGOSING03), y en las entregas
            del programa de Ingeniería Financiera de la UPP. Para este fin usamos únicamente
            datos <T>agregados y anonimizados</T> —por ejemplo, cuántas personas usan una
            función, o el desempeño de una cartera de demostración—. No mostramos tu nombre,
            tu correo, tus montos ni tus operaciones.
          </li>
        </UL>
        <P>
          Para negarte a cualquiera de estas finalidades, escríbenos a <CorreoPrivacidad />{' '}
          indicando a cuál te opones, o desactiva las funciones sociales desde{' '}
          <span className="font-mono text-sm">Configuración › Privacidad</span>. Tu negativa no
          es motivo para negarte el servicio.
        </P>

        {/* 5 */}
        <H2 id="s5" n="5">Quién más interviene y dónde se almacenan</H2>

        <H3>Encargados</H3>
        <P>
          Usamos proveedores que tratan datos <T>por cuenta nuestra</T>, siguiendo nuestras
          instrucciones y sin finalidades propias. La ley los llama <T>encargados</T>, y
          recurrir a ellos no constituye una transferencia, por lo que no requiere tu
          consentimiento adicional:
        </P>
        <UL>
          <li>
            <T>Supabase</T> — base de datos y autenticación.
          </li>
          <li>
            <T>Vercel</T> — hospedaje de la aplicación y registros de servidor.
          </li>
          <li>
            <T>Upstash</T> — caché temporal para acelerar respuestas.
          </li>
          <li>
            <T>PostHog</T> — analítica de producto, solo para la finalidad secundaria
            correspondiente.
          </li>
          <li>
            <T>Sentry</T> — captura de errores de la aplicación.
          </li>
        </UL>

        <H3>Almacenamiento fuera de México</H3>
        <P>
          Los servidores de estos proveedores se ubican en <T>Estados Unidos de América</T>.
          Al usar la plataforma reconoces que tus datos se almacenan y procesan fuera del
          territorio nacional.
        </P>

        <H3>Proveedores de datos de mercado</H3>
        <P>
          Para mostrarte precios consultamos servicios externos de información financiera
          (entre ellos Twelve Data, Finnhub y Yahoo Finance). A estos servicios les enviamos
          únicamente el <T>símbolo del instrumento</T> que se está consultando. No reciben tu
          identidad, tus cantidades, tus montos ni ningún otro dato personal tuyo.
        </P>

        <H3>Transferencias</H3>
        <P>
          <T>No vendemos, rentamos ni cedemos tus datos personales a terceros</T> para
          finalidades propias de esos terceros. Fuera de los encargados listados arriba, tus
          datos solo salen de la plataforma en dos casos: cuando tú decides publicar o
          compartir un portafolio, y cuando una autoridad competente lo requiera en ejercicio
          de sus facultades.
        </P>

        {/* 6 */}
        <H2 id="s6" n="6">Tus derechos ARCO y cómo ejercerlos</H2>
        <P>
          La ley te reconoce cuatro derechos sobre tus datos personales, conocidos en conjunto
          como <T>derechos ARCO</T>:
        </P>
        <UL>
          <li>
            <T>Acceso.</T> Saber qué datos tenemos de ti, para qué los usamos y en qué
            condiciones.
          </li>
          <li>
            <T>Rectificación.</T> Corregirlos cuando estén desactualizados, sean inexactos o
            estén incompletos.
          </li>
          <li>
            <T>Cancelación.</T> Pedir que los eliminemos de nuestros registros cuando
            consideres que no se están usando conforme a los principios y deberes que la ley
            impone.
          </li>
          <li>
            <T>Oposición.</T> Oponerte al uso de tus datos para finalidades específicas.
          </li>
        </UL>

        <H3>Cómo presentar tu solicitud</H3>
        <P>
          Envíala a <CorreoPrivacidad />. Conforme al artículo 29 de la LFPDPPP, tu solicitud
          debe contener:
        </P>
        <UL>
          <li>Tu nombre y un medio para comunicarte la respuesta.</li>
          <li>
            Los documentos que acrediten tu identidad o, en su caso, la representación legal de
            quien actúe por ti.
          </li>
          <li>La descripción clara de los datos respecto de los que ejerces el derecho.</li>
          <li>
            Cualquier elemento que facilite localizar los datos, y —si pides rectificación— la
            modificación solicitada y el documento que la sustente.
          </li>
        </UL>

        <H3>Plazos</H3>
        <P>
          Te responderemos en un máximo de <T>veinte días hábiles</T> contados desde que
          recibamos tu solicitud. Si procede, la haremos efectiva dentro de los{' '}
          <T>quince días hábiles</T> siguientes a la respuesta, conforme al artículo 32 de la
          LFPDPPP. El ejercicio de estos derechos es gratuito; solo podríamos cobrarte los
          gastos justificados de envío o reproducción.
        </P>

        <H3>Límites</H3>
        <P>
          La ley prevé casos en que una solicitud puede no proceder, por ejemplo cuando otra
          disposición nos obliga a conservar cierta información. Si eso ocurre te lo diremos de
          forma fundada y motivada.
        </P>

        <H3>Si no estás conforme</H3>
        <P>
          Puedes acudir al <T>Instituto Nacional de Transparencia, Acceso a la Información y
          Protección de Datos Personales</T> (INAI) para presentar una solicitud de protección
          de datos, en{' '}
          <a
            href="https://home.inai.org.mx/"
            className="text-primary underline underline-offset-4"
            target="_blank"
            rel="noopener noreferrer"
          >
            home.inai.org.mx
          </a>
          .
        </P>

        {/* 7 */}
        <H2 id="s7" n="7">Revocar tu consentimiento</H2>
        <P>
          Puedes revocar en cualquier momento el consentimiento que nos otorgaste, así como
          limitar el uso o divulgación de tus datos, escribiéndonos a <CorreoPrivacidad />.
        </P>
        <P>
          Ten en cuenta que revocar el consentimiento para las finalidades{' '}
          <T>primarias</T> implica que ya no podemos prestarte el servicio, porque sin esos
          datos la plataforma no puede funcionar: en ese caso tu cuenta se cierra y tus datos
          se eliminan. Revocar el consentimiento para las finalidades{' '}
          <T>secundarias</T> no afecta tu cuenta.
        </P>
        <P>
          También puedes eliminar por tu cuenta portafolios, posiciones y transacciones
          individuales desde la propia plataforma, en cualquier momento.
        </P>

        {/* 8 */}
        <H2 id="s8" n="8">Cookies y tecnologías de rastreo</H2>
        <UL>
          <li>
            <T>Cookies necesarias.</T> Mantienen tu sesión abierta y recuerdan tu idioma. Sin
            ellas no podrías permanecer autenticado.
          </li>
          <li>
            <T>Almacenamiento local en tu navegador.</T> Guarda preferencias de interfaz y
            datos para que la aplicación funcione sin conexión. Vive en tu dispositivo y puedes
            borrarlo desde la configuración de tu navegador.
          </li>
          <li>
            <T>Analítica.</T> Cuando la analítica de producto está activa, nuestro proveedor
            usa identificadores para distinguir visitas. Se asocian a tu identificador interno
            de usuario, nunca a tu correo ni a tu nombre, y puedes oponerte a esta finalidad
            conforme a la sección 4.
          </li>
        </UL>

        {/* 9 */}
        <H2 id="s9" n="9">Cambios a este aviso</H2>
        <P>
          Podemos modificar este aviso para reflejar cambios en la plataforma o en la
          normativa. Cualquier cambio se publica en esta misma dirección y queda señalado por
          la fecha de última actualización que aparece al inicio. Si el cambio es sustancial,
          además te lo notificaremos por correo electrónico o mediante un aviso dentro de la
          aplicación antes de que surta efecto. Te recomendamos revisar esta página
          periódicamente.
        </P>

        {/* 10 */}
        <H2 id="s10" n="10">Naturaleza académica del proyecto</H2>
        <P>
          InvestTracker es una plataforma con fines <T>educativos</T>, desarrollada como
          proyecto académico. <T>No constituye asesoría de inversión</T>, no ejecuta órdenes,
          no custodia dinero ni valores, y no está registrada ante la Comisión Nacional
          Bancaria y de Valores como intermediario ni como asesor en inversiones. Las métricas
          y simulaciones que muestra son estimaciones calculadas sobre los datos que tú
          registras y sobre información de mercado de terceros; no son predicciones ni
          garantías de resultados. Las decisiones de inversión son tuyas.
        </P>

        <hr className="mt-12 border-border" />
        <p className="mt-6 text-sm text-muted-foreground">
          Última actualización: {ULTIMA_ACTUALIZACION}.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          <Link href="/" className="text-primary underline underline-offset-4">
            Volver al inicio
          </Link>
        </p>
      </main>
    </div>
  )
}
