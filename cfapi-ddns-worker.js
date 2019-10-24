// CloudFlare API token
// for zone: example.com (Edit)
const API_TOKEN = "9TEbDiJr2OPLPHeaAm9co4cPcc6aCyXw3eFCqQRZ";
// Currently, there seems not to be a way to get zone ids with tokens. So hardcode it here.
// https://community.cloudflare.com/t/bug-in-list-zones-endpoint-when-using-api-token/115048
const ZONES = {
  "example.com.": { 
    id: "ebb79c493284ba2be5cc932ef944e41b"
  },
};
// API tokens, mapping domains to customizable tokens, which can be any text.
// Tokens for a domain can always be used to access its direct or indirect subdomains.
const TOKENS = /* TOKENS: */ {
  "dyn.example.com.": "5b9ecec4-8e23-4ffc-8e9b-b1f7d37f5ef5",
  "bomb.dyn.example.com.": "88a9af6a-53aa-4757-91be-a15497626452",
} /* :TOKENS */;
// Time To Live in DNS record. 1 indictes automatic.
const TTL = 1;
// Currently, the script won't create record for non-existent (sub)domains.
//const AUTO_CREATE = true;

class ClientError extends Error {}

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

/**
 * Respond to the request
 * @param {Request} request
 */
async function handleRequest(request) {
  const url = new URL(request.url);
  try {
      if (url.pathname.startsWith("/update/")) {
        return await handleUpdate(request);
      }
      else {
        return new Response(`Resource Not Found at Endpoint ${url.pathname}`, { status: 404 });
      }
  }
  catch (e) {
    if (e instanceof ClientError) {
      return new Response(e, { status: 400 });
    }
    else {
      return new Response(e, { status: 500 });
    }
  }
}

async function handleUpdate(request) {
  const url = new URL(request.url);
  const path = url.pathname.startsWith("/") ? url.pathname.substring(1) : url.pathname;
  const [, token, domain, rtype, content] = path.split("/", 5);
  if ([token, domain, rtype, content].some((e) => e === undefined)) {
    throw new ClientError("Malformed parameters");
  }
  const canon_domain = canonicalizeDomain(domain);
  const effective_domain = getEffectiveDomain(token, canon_domain);
  if (effective_domain === undefined) {
    throw new ClientError("Invalid token");
  }
  let { id: zone_id } = getZoneByDomain(effective_domain);
  if (zone_id === undefined) {
    throw new ClientError("Unknown zone");
  }
  const records = (await getAPI(`zones/${zone_id}/dns_records?name=${simplifyDomain(domain)}&type=${rtype}`)).result;
  if (records.length === 0) {
    throw new ClientError("Record Not Found");
  }
  else if (records.length > 1) { 
    throw new ClientError("Records Not Unique");
  }
  const record_id = records[0].id;
  const result = await putAPI(`zones/${zone_id}/dns_records/${record_id}`, {type: rtype, name: simplifyDomain(domain), content: content});
  if (!result.success) {
    throw new Error(`Upstream erorr (${errors})`);
  }
  return new Response(`Successfully Updated at ${new Date()}`, { status: 200 });
}

async function requestAPI(method, path, data) {
  const response = await fetch("https://api.cloudflare.com/client/v4/" + path, {
    method: method,
    headers: {
      "Authorization": `Bearer ${API_TOKEN}`,
      "Content-Type": "application/json"
      },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(`Upstream response error (status code: ${response.status})`);
  }
  try {
    return await response.json();
  }
  catch (e) {
    throw new Error("Upstream invalid response");
  }
}

function getAPI(path, data) {
  return requestAPI("GET", path, data);
}

function postAPI(path, data) {
  return requestAPI("POST", path, data);
}

function putAPI(path, data) {
  return requestAPI("PUT", path, data);
}

// Search predefined ZONES for matching domain, returning the matched zone.
function getZoneByDomain(domain) {
  let zone;
  for (const parent_domain of parentDomains(domain)) {
    if (ZONES[parent_domain] !== undefined) {
      zone = ZONES[parent_domain];
      break;
    }
  }
  return zone;
}

// Search TOKENS for matching token, serving as authentication process.
function getEffectiveDomain(token, domain) {
  let effective_domain;
  for (const parent_domain of parentDomains(domain)) {
    if (TOKENS[parent_domain] === token) {
      effective_domain = parent_domain;
      break;
    }
  }
  return effective_domain;
}

// Generator function yielding a canonicalized domain and all of its parent-domains.
// e.g. parentDomains("www.example.org.") -> ["www.example.org.", example.org., org.]*
function* parentDomains(domain) {
  if (domain !== ".") {
    let dot = -1;
    do {
      domain = domain.substring(dot + 1);
      yield domain;
      dot = domain.indexOf(".");
    }
    while (dot != domain.length - 1)
  }
  yield ".";
}

// Strip the trailing dot indicating root domain, if it is present.
// Necessary because the poor CloudFlare cannot understand canonicalized domains.
function simplifyDomain(domain) {
  if (domain.endsWith(".")) {
    domain = domain.substring(0, domain.length - 1);
  }
  return domain;
}

// Canonicalize the domain by add trailing dot indicating root domain, if it is not present. 
function canonicalizeDomain(domain) {
  if (!domain.endsWith(".")) {
    domain += ".";
  }
  return domain;
}
