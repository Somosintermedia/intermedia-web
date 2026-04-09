/**
 * Netlify Function: crea un contacto en HubSpot (CRM v3).
 * Variables de entorno: HUBSPOT_TOKEN (Private App access token)
 *
 * POST JSON: { "nombre": "...", "email": "...", "telefono": "..." }
 *
 * Si el contacto ya existe (409), actualiza firstname y phone con PATCH.
 */

const HUBSPOT_URL = "https://api.hubapi.com/crm/v3/objects/contacts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

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

  const msg =
    typeof data.message === "string" ? data.message : "";
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
  if (
    cat === "OBJECT_ALREADY_EXISTS" ||
    errCode === "CONTACT_EXISTS"
  ) {
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

  const nombre = payload.nombre != null ? String(payload.nombre).trim() : "";
  const email = payload.email != null ? String(payload.email).trim() : "";
  const telefono =
    payload.telefono != null ? String(payload.telefono).trim() : "";

  if (!email) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: "email es obligatorio" }),
    };
  }

  const properties = {
    email,
    ...(nombre && { firstname: nombre }),
    ...(telefono && { phone: telefono }),
  };

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

      const patchProps = {};
      if (nombre) patchProps.firstname = nombre;
      if (telefono) patchProps.phone = telefono;

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
