/**
 * Netlify Function: crea o actualiza un contacto en HubSpot (CRM v3).
 * Variables de entorno: HUBSPOT_TOKEN (Private App access token)
 *
 * POST JSON: nombre, email, telefono + respuestas del test (propiedades personalizadas)
 * Email o teléfono obligatorio (p. ej. solicitud de llamada sin email).
 *
 * Si el contacto ya existe (409), actualiza firstname, phone y respuestas con PATCH.
 */

const HUBSPOT_URL = "https://api.hubapi.com/crm/v3/objects/contacts";

/** Nombres internos en HubSpot (deben existir como propiedades de contacto) */
const TEST_PROP_KEYS = [
  "situacion_de_pago",
  "has_recibido_alguna_comunicacion_formal_relacionada_con_la_deuda",
  "la_vivienda_relacionada_con_la_hipoteca_esesta",
  "que_te_gustaria_que_pudiera_ocurrir",
  "cual_es_aproximadamente_la_deuda_pendiente_de_tu_hipoteca",
  "cual_crees_que_podria_ser_el_valor_aproximado_de_tu_vivienda_hoy",
  "ciudad_o_municipio_de_la_vivienda",
  "que_es_lo_que_mas_necesitas_en_este_momento",
];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function str(v) {
  if (v == null) return "";
  return String(v).trim();
}

/**
 * @param {object} payload
 * @param {{ includeEmail: boolean }} opts
 */
function buildContactProperties(payload, opts) {
  const props = {};
  if (opts.includeEmail) {
    const email = str(payload.email);
    const telefono = str(payload.telefono);
    if (email) {
      props.email = email;
    } else if (telefono) {
      const digits = telefono.replace(/\D/g, "") || "0";
      props.email = `solicitud-llamada+${digits}@somosintermedia.com`;
    }
  }
  const nombre = str(payload.nombre);
  if (nombre) props.firstname = nombre;
  const telefono = str(payload.telefono);
  if (telefono) props.phone = telefono;
  const mensaje = str(payload.mensaje);
  if (mensaje) props.mensaje_contacto = mensaje;
  const origen = str(payload.origen);
  if (origen) props.origen = origen;
  for (const key of TEST_PROP_KEYS) {
    const val = str(payload[key]);
    if (val) props[key] = val;
  }
  return props;
}

/** HubSpot 409: extrae el ID del contacto existente del cuerpo de error */
function extractExistingContactId(data) {
  if (!data || typeof data !== "object") return null;

  const fromVid =
    data.identityProfile && data.identityProfile.vid != null
      ? String(data.identityProfile.vid)
      : null;
  if (fromVid && /^\d+$/.test(fromVid)) return fromVid;

  const fromContext =
    data.context && data.context.id != null ? String(data.context.id) : null;
  if (fromContext && /^\d+$/.test(fromContext)) return fromContext;

  if (Array.isArray(data.errors)) {
    for (const err of data.errors) {
      const id =
        err && err.context && err.context.id != null
          ? String(err.context.id)
          : null;
      if (id && /^\d+$/.test(id)) return id;
    }
  }

  const msg = typeof data.message === "string" ? data.message : "";
  const match = msg.match(/Existing ID:\s*(\d+)/i);
  if (match) return match[1];

  const matchEs = msg.match(/ID\s*(?:existente|existentes)?\s*:?\s*(\d+)/i);
  if (matchEs) return matchEs[1];

  return null;
}

function isDuplicateContactError(status, data) {
  if (status !== 409) return false;
  if (!data || typeof data !== "object") return false;
  const msg = (data.message || "").toLowerCase();
  const cat = (data.category || "").toUpperCase();
  const errCode = (data.error || "").toUpperCase();
  if (cat === "OBJECT_ALREADY_EXISTS" || errCode === "CONTACT_EXISTS") {
    return true;
  }
  if (msg.includes("already exists") || msg.includes("ya existe")) {
    return true;
  }
  if (extractExistingContactId(data)) return true;
  return false;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  const token = process.env.HUBSPOT_TOKEN;
  if (!token) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "HUBSPOT_TOKEN no configurado" }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: "JSON inválido" }),
    };
  }

  const email = str(payload.email);
  const telefono = str(payload.telefono);
  if (!email && !telefono) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: "Se requiere email o teléfono",
      }),
    };
  }

  const properties = buildContactProperties(payload, { includeEmail: true });

  try {
    const res = await fetch(HUBSPOT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ properties }),
    });

    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      return {
        statusCode: 201,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          id: data.id,
        }),
      };
    }

    if (isDuplicateContactError(res.status, data)) {
      const existingId = extractExistingContactId(data);
      if (!existingId) {
        return {
          statusCode: 409,
          headers: corsHeaders,
          body: JSON.stringify({
            error:
              data.message ||
              "Contacto duplicado: no se pudo obtener el ID existente",
            details: data,
          }),
        };
      }

      const patchProps = buildContactProperties(payload, {
        includeEmail: false,
      });

      if (Object.keys(patchProps).length === 0) {
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            success: true,
            id: existingId,
            duplicate: true,
            updated: false,
          }),
        };
      }

      const patchRes = await fetch(
        `${HUBSPOT_URL}/${encodeURIComponent(existingId)}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ properties: patchProps }),
        }
      );

      const patchData = await patchRes.json().catch(() => ({}));

      if (!patchRes.ok) {
        return {
          statusCode:
            patchRes.status >= 400 && patchRes.status < 600
              ? patchRes.status
              : 502,
          headers: corsHeaders,
          body: JSON.stringify({
            error: patchData.message || "Error al actualizar contacto duplicado",
            details: patchData,
          }),
        };
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          id: existingId,
          duplicate: true,
          updated: true,
        }),
      };
    }

    return {
      statusCode: res.status >= 400 && res.status < 600 ? res.status : 502,
      headers: corsHeaders,
      body: JSON.stringify({
        error: data.message || "Error de HubSpot",
        details: data,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: err.message || "Error al contactar con HubSpot",
      }),
    };
  }
};
