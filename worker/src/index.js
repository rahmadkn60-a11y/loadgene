export default {
  async fetch(request, env) {
    // =========================
    // CORS
    // =========================

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    // =========================
    // PREFLIGHT
    // =========================

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    // =========================
    // ONLY POST /upload
    // =========================

    const url = new URL(request.url);

    if (url.pathname !== "/upload") {
      return json(
        {
          success: false,
          error: "Endpoint tidak ditemukan."
        },
        404,
        corsHeaders
      );
    }

    if (request.method !== "POST") {
      return json(
        {
          success: false,
          error: "Method harus POST."
        },
        405,
        corsHeaders
      );
    }

    // =========================
    // CHECK ENVIRONMENT
    // =========================

    if (!env.GITHUB_TOKEN) {
      return json(
        {
          success: false,
          error: "GITHUB_TOKEN belum dikonfigurasi."
        },
        500,
        corsHeaders
      );
    }

    if (!env.GITHUB_OWNER || !env.GITHUB_REPO) {
      return json(
        {
          success: false,
          error: "Konfigurasi repository belum lengkap."
        },
        500,
        corsHeaders
      );
    }

    // =========================
    // READ REQUEST
    // =========================

    let body;

    try {
      body = await request.json();
    } catch {
      return json(
        {
          success: false,
          error: "Request body harus berupa JSON."
        },
        400,
        corsHeaders
      );
    }

    const code =
      typeof body.code === "string"
        ? body.code
        : "";

    if (!code.trim()) {
      return json(
        {
          success: false,
          error: "Kode Lua/Luau kosong."
        },
        400,
        corsHeaders
      );
    }

    // =========================
    // BASIC SIZE LIMIT
    // =========================

    const MAX_SIZE = 1024 * 1024;

    if (new TextEncoder().encode(code).length > MAX_SIZE) {
      return json(
        {
          success: false,
          error: "Ukuran kode terlalu besar. Maksimum 1 MB."
        },
        413,
        corsHeaders
      );
    }

    // =========================
    // RANDOM FILENAME
    // =========================

    const filename = createRandomFilename();

    const path =
      `${env.GITHUB_FOLDER || "uploads"}/${filename}`;

    // =========================
    // ENCODE CONTENT
    // =========================

    const contentBase64 =
      uint8ToBase64(
        new TextEncoder().encode(code)
      );

    // =========================
    // GITHUB API
    // =========================

    const githubUrl =
      `https://api.github.com/repos/` +
      `${encodeURIComponent(env.GITHUB_OWNER)}/` +
      `${encodeURIComponent(env.GITHUB_REPO)}/contents/` +
      `${path}`;

    const githubResponse =
      await fetch(githubUrl, {
        method: "PUT",

        headers: {
          "Authorization":
            `Bearer ${env.GITHUB_TOKEN}`,

          "Accept":
            "application/vnd.github+json",

          "X-GitHub-Api-Version":
            "2022-11-28",

          "User-Agent":
            "LuaForge-Cloudflare-Worker",

          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          message:
            `Upload ${filename}`,

          content:
            contentBase64
        })
      });

    // =========================
    // GITHUB ERROR
    // =========================

    if (!githubResponse.ok) {

      const githubText =
        await githubResponse.text();

      console.error(
        "GitHub API error:",
        githubText
      );

      return json(
        {
          success: false,
          error: "GitHub gagal menerima file."
        },
        502,
        corsHeaders
      );
    }

    // =========================
    // BUILD RAW URL
    // =========================

    const rawUrl =
      `https://raw.githubusercontent.com/` +
      `${env.GITHUB_OWNER}/` +
      `${env.GITHUB_REPO}/` +
      `${env.GITHUB_BRANCH || "main"}/` +
      `${path}`;

    // =========================
    // LOADSTRING
    // =========================

    const loadstring =
      `loadstring(game:HttpGet("${rawUrl}"))()`;

    // =========================
    // RESPONSE
    // =========================

    return json(
      {
        success: true,

        filename,

        path,

        rawUrl,

        loadstring
      },
      200,
      corsHeaders
    );
  }
};


// ========================================
// RANDOM FILENAME
// ========================================

function createRandomFilename() {

  const alphabet =
    "abcdefghijklmnopqrstuvwxyz" +
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ" +
    "0123456789";

  const bytes =
    crypto.getRandomValues(
      new Uint8Array(24)
    );

  let result = "";

  for (const byte of bytes) {
    result +=
      alphabet[
        byte % alphabet.length
      ];
  }

  return `${result}.lua`;
}


// ========================================
// UINT8ARRAY → BASE64
// ========================================

function uint8ToBase64(bytes) {

  let binary = "";

  const CHUNK_SIZE = 0x8000;

  for (
    let i = 0;
    i < bytes.length;
    i += CHUNK_SIZE
  ) {

    binary += String.fromCharCode(
      ...bytes.subarray(
        i,
        Math.min(
          i + CHUNK_SIZE,
          bytes.length
        )
      )
    );
  }

  return btoa(binary);
}


// ========================================
// JSON RESPONSE
// ========================================

function json(
  data,
  status = 200,
  extraHeaders = {}
) {

  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: {
        "Content-Type":
          "application/json; charset=utf-8",

        ...extraHeaders
      }
    }
  );
}
