export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    const url = new URL(request.url);

    // Health check
    if (url.pathname === "/" && request.method === "GET") {
      return json(
        {
          success: true,
          service: "LuaForge API",
          status: "online"
        },
        200,
        corsHeaders
      );
    }

    // Upload endpoint
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

    // Required environment variables
    const required = [
      "GITHUB_TOKEN",
      "GITHUB_OWNER",
      "GITHUB_REPO"
    ];

    for (const key of required) {
      if (!env[key]) {
        return json(
          {
            success: false,
            error: `Konfigurasi ${key} belum tersedia.`
          },
          500,
          corsHeaders
        );
      }
    }

    // Read request body
    let body;

    try {
      body = await request.json();
    } catch {
      return json(
        {
          success: false,
          error: "Request harus berupa JSON yang valid."
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

    // 1 MB limit
    const encoded =
      new TextEncoder().encode(code);

    if (encoded.byteLength > 1024 * 1024) {
      return json(
        {
          success: false,
          error: "Ukuran kode melebihi batas 1 MB."
        },
        413,
        corsHeaders
      );
    }

    const branch =
      env.GITHUB_BRANCH || "main";

    const folder =
      normalizeFolder(
        env.GITHUB_FOLDER || "uploads"
      );

    /*
     * Cari nama file acak yang belum digunakan.
     */
    let filename = null;
    let path = null;

    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate =
        createRandomFilename();

      const candidatePath =
        folder
          ? `${folder}/${candidate}`
          : candidate;

      const exists =
        await githubFileExists(
          candidatePath,
          env
        );

      if (!exists) {
        filename = candidate;
        path = candidatePath;
        break;
      }
    }

    if (!filename || !path) {
      return json(
        {
          success: false,
          error:
            "Gagal mendapatkan nama file unik."
        },
        500,
        corsHeaders
      );
    }

    // Convert source to Base64
    const content =
      uint8ToBase64(encoded);

    // GitHub Contents API
    const githubUrl =
      `https://api.github.com/repos/` +
      `${encodeURIComponent(env.GITHUB_OWNER)}/` +
      `${encodeURIComponent(env.GITHUB_REPO)}/contents/` +
      path
        .split("/")
        .map(encodeURIComponent)
        .join("/");

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
            "LuaForge-Worker",

          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          message:
            `Upload ${filename}`,

          content,

          branch
        })
      });

    if (!githubResponse.ok) {
      const details =
        await githubResponse.text();

      console.error(
        "GitHub API error:",
        details
      );

      return json(
        {
          success: false,
          error:
            "GitHub gagal mengupload file.",
          status:
            githubResponse.status
        },
        502,
        corsHeaders
      );
    }

    // Raw GitHub URL
    const rawUrl =
      `https://raw.githubusercontent.com/` +
      `${env.GITHUB_OWNER}/` +
      `${env.GITHUB_REPO}/` +
      `${encodeURIComponent(branch)}/` +
      `${path
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`;

    // Generated result
    const loadstring =
      `loadstring(game:HttpGet("${rawUrl}"))()`;

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
// CHECK FILE EXISTENCE
// ========================================

async function githubFileExists(path, env) {
  const branch =
    env.GITHUB_BRANCH || "main";

  const url =
    `https://api.github.com/repos/` +
    `${encodeURIComponent(env.GITHUB_OWNER)}/` +
    `${encodeURIComponent(env.GITHUB_REPO)}/contents/` +
    `${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}` +
    `?ref=${encodeURIComponent(branch)}`;

  const response =
    await fetch(url, {
      method: "GET",

      headers: {
        "Authorization":
          `Bearer ${env.GITHUB_TOKEN}`,

        "Accept":
          "application/vnd.github+json",

        "X-GitHub-Api-Version":
          "2022-11-28",

        "User-Agent":
          "LuaForge-Worker"
      }
    });

  return response.status === 200;
}


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
// NORMALIZE FOLDER
// ========================================

function normalizeFolder(folder) {
  return folder
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
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
