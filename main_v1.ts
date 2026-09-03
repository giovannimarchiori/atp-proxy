const TNNL_URL =
  "https://api.tnnslive.com/v1/matches";

const RECENT_FINISHED_HOURS = 12;

interface Match {
  status: string;
  p1: string;
  p2: string;
  s1: number[];
  s2: number[];
  sw: (number | null)[];
  g1: string;
  g2: string;
  server: number | null;
  winner: number | null;
}

interface Tournament {
  name: string;
  matches: Match[];
}


// --------------------------------------------------
// Check whether a season is an ATP Tour tournament
// --------------------------------------------------

function isAtpTournament(season: any): boolean {

  const tour = season?.d?.tour ?? [];

  return (
    tour.includes("atp") &&
    tour.includes("tour")
  );
}


// --------------------------------------------------
// Convert one Tnnslive match to our compact format
// --------------------------------------------------

function transformMatch(m: any): Match | null {

  const players = m?.p ?? [];

  if (players.length < 2) {
    return null;
  }

  const p1 = players[0];
  const p2 = players[1];

  const s1: number[] = [];
  const s2: number[] = [];
  const sw: (number | null)[] = [];

  for (const score of (m?.sc ?? []).slice(0, 5)) {

    if (!score || score.length < 2) {
      continue;
    }

    const a = score[0];
    const b = score[1];

    if (a == null || b == null) {
      continue;
    }

    s1.push(a);
    s2.push(b);

    // Tnnslive convention:
    //   1 = player 1 won the set
    //   0 = player 2 won the set
    //
    // This is also the convention used by our Garmin app.
    if (score.length >= 3) {
      sw.push(score[2] == null ? null : score[2]);
    } else {
      sw.push(null);
    }
  }

  const isLive =
    (m?.fs ?? []).includes("l");

  let winner: number | null = null;

  if (!isLive) {

    if (p1?.w === true) {
      winner = 0;
    } else if (p2?.w === true) {
      winner = 1;
    }
  }

  let g1 = "";
  let g2 = "";

  if (isLive) {

    const gs = m?.gs;

    if (Array.isArray(gs) && gs.length >= 2) {
      g1 = gs[0] == null ? "" : String(gs[0]);
      g2 = gs[1] == null ? "" : String(gs[1]);
    }
  }

  let server: number | null = null;

  if (isLive) {

    if (p1?.sv === true) {
      server = 0;
    } else if (p2?.sv === true) {
      server = 1;
    }
  }

  return {
    status: isLive ? "P" : "F",

    p1: p1?.n ?? "",
    p2: p2?.n ?? "",

    s1,
    s2,
    sw,

    g1,
    g2,

    server,
    winner,
  };
}


// --------------------------------------------------
// Transform complete Tnnslive response
// --------------------------------------------------

function transform(data: any): {
  tournaments: Tournament[]
} {

  const sids = data?.sids ?? {};
  const allMatches = data?.all_matches ?? [];

  // season_id -> tournament name
  const atpSeasons =
    new Map<string, string>();

  for (const sidData of Object.values(sids) as any[]) {

    if (!isAtpTournament(sidData)) {
      continue;
    }

    const seasonId =
      sidData?.d?.id_sr;

    if (!seasonId) {
      continue;
    }

    const name =
      sidData?.t ?? "Unknown";

    atpSeasons.set(
      seasonId,
      name,
    );
  }


  // --------------------------------------------------
  // Filter and group matches
  // --------------------------------------------------

  const tournaments =
    new Map<string, Tournament>();

  const now =
    Date.now();

  const recentLimit =
    RECENT_FINISHED_HOURS *
    60 *
    60 *
    1000;


  for (const m of allMatches) {

    const seasonId =
      m?.season_id;

    // Only ATP Tour
    if (!atpSeasons.has(seasonId)) {
      continue;
    }

    const isLive =
      (m?.fs ?? []).includes("l");


    // ------------------------------------------------
    // Live matches
    // ------------------------------------------------

    if (isLive) {
      // Keep live matches.
    }


    // ------------------------------------------------
    // Finished matches
    // ------------------------------------------------

    else {

      const finishedAt =
        m?.finishedAt;

      if (finishedAt == null) {
        // Upcoming match
        continue;
      }

      const finished =
        Number(finishedAt);

      if (!Number.isFinite(finished)) {
        continue;
      }

      const age =
        now - finished;

      // Future match
      if (age < 0) {
        continue;
      }

      // Too old
      if (age > recentLimit) {
        continue;
      }
    }


    const parsed =
      transformMatch(m);

    if (!parsed) {
      continue;
    }


    // ------------------------------------------------
    // Add to tournament
    // ------------------------------------------------

    if (!tournaments.has(seasonId)) {

      tournaments.set(
        seasonId,
        {
          name:
            atpSeasons.get(seasonId)!,

          matches: [],
        },
      );
    }

    tournaments
      .get(seasonId)!
      .matches
      .push(parsed);
  }


  // --------------------------------------------------
  // Sort matches
  //
  // Live first.
  // Finished: newest first.
  // --------------------------------------------------

  for (const tournament of tournaments.values()) {

    tournament.matches.sort(
      (a, b) => {

        if (a.status === "P" &&
            b.status !== "P") {
          return -1;
        }

        if (a.status !== "P" &&
            b.status === "P") {
          return 1;
        }

        return 0;
      },
    );
  }


  return {
    tournaments:
      Array.from(tournaments.values()),
  };
}


// --------------------------------------------------
// HTTP handler
// --------------------------------------------------

export default {

  async fetch(req: Request): Promise<Response> {

    const url =
      new URL(req.url);


    if (url.pathname !== "/atp") {

      return new Response(
        "Not found",
        {
          status: 404,
        },
      );
    }


    try {

      // ------------------------------------------------
      // 1. Download Tnnslive
      // ------------------------------------------------

      const response =
        await fetch(TNNL_URL);
      console.log("status:", response.status);
      console.log("content-type:", response.headers.get("content-type"));
      const text = await response.text();
      console.log("length:", text.length);
      console.log(text.substring(0, 200));

      if (!response.ok) {

        return new Response(
          JSON.stringify({
            error: "Tnnslive error",
            status: response.status,
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


      // ------------------------------------------------
      // 2. Parse JSON
      // ------------------------------------------------

      const data =
        await response.json();


      // ------------------------------------------------
      // 3. Transform
      // ------------------------------------------------

      const result =
        transform(data);


      // ------------------------------------------------
      // 4. Return compact JSON
      // ------------------------------------------------

      return new Response(
        JSON.stringify(result),
        {
          status: 200,

          headers: {
            "content-type":
              "application/json; charset=utf-8",

            "cache-control":
              "no-store",
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
