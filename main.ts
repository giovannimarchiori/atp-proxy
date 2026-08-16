const ATP_URL =
  "https://app.atptour.com/api/v2/gateway/livematches/website?scoringTournamentLevel=tour";

const JINA_URL =
  "https://r.jina.ai/" + ATP_URL;

interface Match {
  status: string;
  p1: string;
  p2: string;
  s1: number[];
  s2: number[];
  g1: number | null;
  g2: number | null;
  server: number | null;
  winner: number | null;
}

interface Tournament {
  name: string;
  matches: Match[];
}

function isGrandSlam(event: any): boolean {
  const title = (event.EventTitle ?? "").toLowerCase();

  return (
    title.includes("australian open") ||
    title.includes("roland garros") ||
    title.includes("wimbledon") ||
    title.includes("us open")
  );
}

function playerName(player: any): string {
  if (!player) return "";

  const first = player.PlayerFirstName ?? "";
  const last = player.PlayerLastName ?? "";

  if (first.length > 0) {
    return `${first.substring(0, 1)}. ${last}`;
  }

  return last;
}

function transform(data: any): { tournaments: Tournament[] } {

  const events =
    data?.Data?.LiveMatchesTournamentsOrdered ?? [];

  const tournaments: Tournament[] = [];

  for (const event of events) {

    const type = event.EventType;

    // Keep ATP 500, ATP 1000 and Grand Slams.
    if (
      type !== "500" &&
      type !== "1000" &&
      !isGrandSlam(event)
    ) {
      continue;
    }

    const name = isGrandSlam(event)
      ? event.EventTitle
      : event.EventCity;

    const matches: Match[] = [];

    for (const m of event.LiveMatches ?? []) {

      if (m.IsDoubles === true) {
        continue;
      }

      const p1team = m.PlayerTeam ?? {};
      const p2team = m.OpponentTeam ?? {};

      const p1 = p1team.Player ?? {};
      const p2 = p2team.Player ?? {};

      const s1: number[] = [];
      const s2: number[] = [];

      for (const score of p1team.SetScores ?? []) {
        if (score.SetScore != null) {
          s1.push(score.SetScore);
        }
      }

      for (const score of p2team.SetScores ?? []) {
        if (score.SetScore != null) {
          s2.push(score.SetScore);
        }
      }

      let winner: number | null = null;

      if (m.WinningPlayerId != null) {

        if (m.WinningPlayerId === p1.PlayerId) {
          winner = 0;
        } else if (m.WinningPlayerId === p2.PlayerId) {
          winner = 1;
        }
      }

      matches.push({
        status: m.MatchStatus ?? "",

        p1: playerName(p1),
        p2: playerName(p2),

        s1,
        s2,

        g1: p1team.GameScore ?? null,
        g2: p2team.GameScore ?? null,

        server: m.ServerTeam ?? null,

        winner,
      });
    }

    if (matches.length > 0) {
      tournaments.push({
        name,
        matches,
      });
    }
  }

  return { tournaments };
}


export default {
  async fetch(req: Request): Promise<Response> {

    const url = new URL(req.url);

    if (url.pathname !== "/atp") {
      return new Response("Not found", {
        status: 404,
      });
    }

    try {

      // --------------------------------------------------
      // 1. Fetch ATP through Jina
      // --------------------------------------------------

      const jinaResponse = await fetch(JINA_URL, {
        headers: {
          "Accept": "application/json",
        },
      });

      if (!jinaResponse.ok) {
        return new Response(
          JSON.stringify({
            error: "Jina error",
            status: jinaResponse.status,
          }),
          {
            status: 502,
            headers: {
              "content-type":
                "application/json; charset=utf-8",
            },
          },
        );
      }

      // --------------------------------------------------
      // 2. Parse Jina wrapper
      // --------------------------------------------------

      const jinaData = await jinaResponse.json();

      const content = jinaData?.data?.content;

      if (typeof content !== "string") {
        return new Response(
          JSON.stringify({
            error: "Jina response has no content",
          }),
          {
            status: 502,
            headers: {
              "content-type":
                "application/json; charset=utf-8",
            },
          },
        );
      }

      // --------------------------------------------------
      // 3. Parse the ATP JSON contained in Jina content
      // --------------------------------------------------

      const atpData = JSON.parse(content);

      // --------------------------------------------------
      // 4. Transform into our small Garmin JSON
      // --------------------------------------------------

      const result = transform(atpData);

      // --------------------------------------------------
      // 5. Return small clean JSON to Garmin
      // --------------------------------------------------

      return new Response(
        JSON.stringify(result),
        {
          status: 200,
          headers: {
            "content-type":
              "application/json; charset=utf-8",

            "cache-control": "no-store",
          },
        },
      );

    } catch (error) {

      return new Response(
        JSON.stringify({
          error: String(error),
        }),
        {
          status: 500,
          headers: {
            "content-type":
              "application/json; charset=utf-8",
          },
        },
      );
    }
  },
};
