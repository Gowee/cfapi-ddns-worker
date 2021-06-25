// CloudFlare API token
// for zone: example.com (Edit)
const CLOUDFLARE_API_TOKEN = "TO_BE_FILLED";
// Currently, there seems not to be a way to get zone ids with tokens. So hardcode it here.
// https://community.cloudflare.com/t/bug-in-list-zones-endpoint-when-using-api-token/115048
// Trailing dots CANNOT BE OMITTED.
const ZONES = {
  "example.org.": {
    id: "TO_BE_FILLED"
  },
};
// Arbitrary API tokens, mapping domains to customizable tokens, which can be any text.
// Tokens for a domain can always be used to access its direct or indirect subdomains.
// Trailing dots CANNOT BE OMITTED.
const TOKENS = /* TOKENS: */ {
  "example.org.": "b69541a8-0acd-4e14-aecf-053d5e1b923d",
  "foo.example.org.": "144e7c59-7c2b-4360-9d16-00bbad549fb9",
  "foo.bar.example.org.": "218fa52e-d3c9-419d-a800-d8510e899a30",
} /* :TOKENS */;
// Time To Live in DNS record. 1 indictes automatic.
const TTL = 1;

class Flare {
  constructor(api_token) {
    this.api_token = api_token;
  }

  async request(method, path, data) {
    const response = await fetch("https://api.cloudflare.com/client/v4/" + path, {
      method: method,
      headers: {
        "Authorization": `Bearer ${this.api_token}`,
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

  get(path, data) {
    return this.request("GET", path, data);
  }

  post(path, data) {
    return this.request("POST", path, data);
  }

  put(path, data) {
    return this.request("PUT", path, data);
  }

  delete(path, data) {
    return this.request("delete", path, data);
  }
}

const flare = new Flare(CLOUDFLARE_API_TOKEN);

class ClientError extends Error { }

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
})

/**
 * Respond to the request
 * @param {Request} request
 */
async function handleRequest(request) {
  const url = new URL(request.url);
  if (url.pathname === "/") {
    return new Response("cfapi-ddns-worker.js is up");
  }
  try {
    const path = url.pathname.startsWith("/") ? url.pathname.substring(1) : url.pathname;
    const [action, token, domain, rtype, content] = path.split("/", 5);
    if (["update", "create", "delete", "upsert"].includes(action)) {
      if ([token, domain, rtype, content].some((e) => e === undefined)) {
        throw new ClientError("Parameters Missing");
      }
      return await handleAction(action, token, domain, rtype, content);
    }
    else {
      return new Response(`Unsupported action: ${action}`, { status: 404 });
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

async function handleAction(action, token, domain, rtype, content) {
  const canon_domain = canonicalizeDomain(domain);
  const effective_domain = getEffectiveDomain(token, canon_domain);
  if (effective_domain === undefined) {
    throw new ClientError("Invalid token");
  }
  let { id: zone_id } = getZoneByDomain(effective_domain);
  if (zone_id === undefined) {
    throw new ClientError(`Zone ID has not been specified for the domain ${effective_domain}`);
  }
  const records = (await flare.get(`zones/${zone_id}/dns_records?name=${simplifyDomain(domain)}&type=${rtype}`)).result;
  if (action === "upsert" && records.length === 0) {
    action = "create";
  }
  else {
    action = "update";
  }
  let result;
  switch (action) {
    case "create":
      if (records.length > 0) {
        throw new ClientError("Record Already Existing");
      }
      result = await flare.post(`zones/${zone_id}/dns_records`, { type: rtype, name: simplifyDomain(domain), content: content });
      break;
    case "update":
    case "delete":
      if (records.length > 1) {
        throw new ClientError("Record Not Unique");
      }
      else if (records.length == 0) {
        throw new ClientError("Record Not Found")
      }
      const record_id = records[0].id;
      if (action === "update") {
        result = await flare.put(`zones/${zone_id}/dns_records/${record_id}`, { type: rtype, name: simplifyDomain(domain), content: content });
      } else { // delete
        result = await flare.delete(`zones/${zone_id}/dns_records/${record_id}`);
      }
      break;
  }
  if (!result.success) {
    throw new Error(`Upstream erorr (${errors})`);
  }
  return new Response(`Successfully Updated at ${new Date()}`, { status: 200 });
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
    console.log(parent_domain, TOKENS[parent_domain]);
    if (TOKENS[parent_domain] && TOKENS[parent_domain] === token) {
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

