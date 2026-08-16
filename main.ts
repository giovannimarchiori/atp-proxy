Deno.serve(async (req) => {
    return new Response(
        JSON.stringify({
            status: "OK",
            message: "ATP proxy is alive"
        }),
        {
            headers: {
                "content-type": "application/json"
            }
        }
    );
});
