async function test() {
  const fetch = (await import("node-fetch")).default || require("node-fetch");

  // Test missing code
  let res = await fetch("http://localhost:8080/check-code", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "code=invalid"
  });
  let text = await res.text();
  console.log("Response for invalid code (should fail):", text.includes("Code onjuist.") || text.includes("Verbindingsfout"));

  // Check admin code
  res = await fetch("http://localhost:8080/check-code", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "code=ADMIN-1234"
  });
  // Since it's a redirect, we'll see if it works
  console.log("Admin code response URL:", res.url);
}

test();
