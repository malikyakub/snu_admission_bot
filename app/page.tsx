export default function HomePage() {
  return (
    <main style={{ maxWidth: 640, margin: "4rem auto", padding: "0 1.25rem" }}>
      <h1 style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>SNUBot</h1>
      <p style={{ color: "#444", lineHeight: 1.5 }}>
        API is live at <code>POST /api/chat</code>. Send{" "}
        <code>{`{ "message": "..." }`}</code> (optional{" "}
        <code>history</code>, set <code>stream: false</code> for JSON).
      </p>
    </main>
  );
}
