const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="8" fill="#101c25"/>
  <path d="M8 9h16v4H12v3h10v4H12v3h12v4H8z" fill="#ebba43"/>
  <path d="M23 5h4v4h-4z" fill="#55c9d4"/>
</svg>`;

export const dynamic = "force-static";

export function GET() {
  return new Response(favicon, {
    headers: {
      "Cache-Control": "public, max-age=86400, immutable",
      "Content-Type": "image/svg+xml; charset=utf-8",
    },
  });
}
