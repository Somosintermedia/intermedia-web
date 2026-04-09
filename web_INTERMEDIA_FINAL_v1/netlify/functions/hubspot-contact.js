/**
 * Netlify Function: crea un contacto en HubSpot (CRM v3).
 * Variables de entorno: HUBSPOT_TOKEN (Private App access token)
 *
 * POST JSON: { "nombre": "...", "email": "...", "telefono": "..." }
 */

const HUBSPOT_URL = "https://api.hubapi.com/crm/v3/objects/contacts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

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

    if (!res.ok) {
      return {
        statusCode: res.status >= 400 && res.status < 600 ? res.status : 502,
        headers: corsHeaders,
        body: JSON.stringify({
          error: data.message || "Error de HubSpot",
          details: data,
        }),
      };
    }

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        id: data.id,
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
