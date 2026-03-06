/**
 * SunEscape — Application Tests
 *
 * Strategy: app.js exports its internals in CommonJS environments, so we
 * `require` it directly in Jest (jsdom) and test the actual application code.
 */

"use strict";

const fs = require("fs");
const path = require("path");

// ── Helpers ────────────────────────────────────────────────────────────────────

function readProjectFile(filename) {
  return fs.readFileSync(path.resolve(__dirname, "..", filename), "utf8");
}

/** Build a minimal chainable Supabase mock client. */
function buildMockSupabaseClient() {
  // Chain object returned by .from()
  const chain = {};
  const noop = () => chain;
  [
    "select", "insert", "update", "delete", "upsert",
    "eq", "in", "order", "not", "limit", "neq", "is",
  ].forEach((m) => { chain[m] = jest.fn(noop); });
  chain.single = jest.fn(() => Promise.resolve({ data: null, error: null }));
  chain.maybeSingle = jest.fn(() => Promise.resolve({ data: null, error: null }));
  // Make chained terminal calls return a resolved promise
  ["select", "insert", "update", "delete", "upsert"].forEach((m) => {
    chain[m] = jest.fn(() => {
      const nextChain = { ...chain };
      // The last call in a chain should be awaitable
      const p = Promise.resolve({ data: [], error: null });
      Object.keys(chain).forEach((k) => { p[k] = chain[k]; });
      return nextChain;
    });
  });

  return {
    _chain: chain,
    from: jest.fn(() => chain),
    auth: {
      getSession: jest.fn(() =>
        Promise.resolve({ data: { session: null }, error: null })
      ),
      onAuthStateChange: jest.fn(() => ({
        data: { subscription: { unsubscribe: jest.fn() } },
      })),
      signInWithPassword: jest.fn(() =>
        Promise.resolve({ data: { session: null, user: null }, error: null })
      ),
      signUp: jest.fn(() =>
        Promise.resolve({ data: { session: null, user: null }, error: null })
      ),
      signOut: jest.fn(() => Promise.resolve({ error: null })),
      resetPasswordForEmail: jest.fn(() => Promise.resolve({ error: null })),
      updateUser: jest.fn(() => Promise.resolve({ error: null })),
    },
    functions: {
      invoke: jest.fn(() => Promise.resolve({ data: null, error: null })),
    },
  };
}

/** Inject index.html body into jsdom document. */
function loadHTML() {
  const html = readProjectFile("index.html");
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) document.body.innerHTML = bodyMatch[1];
}

/**
 * Reset module cache, set up globals, load app.js via require, inject the
 * mock Supabase client, and return { app, client }.
 */
function setupApp(overrideClient) {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  loadHTML();

  const client = overrideClient || buildMockSupabaseClient();
  global.SUPABASE_URL = "https://test.supabase.co";
  global.SUPABASE_ANON_KEY = "test-anon-key";
  global.VAPID_PUBLIC_KEY = "test-vapid-key";
  global.supabase = { createClient: jest.fn(() => client) };

  jest.resetModules();
  const app = require("../app.js");
  app.supabaseClient = client;
  return { app, client };
}

// ── Date helper functions ─────────────────────────────────────────────────────

describe("toISO()", () => {
  let app;
  beforeEach(() => { ({ app } = setupApp()); });

  test("converts a Date to YYYY-MM-DD format", () => {
    expect(app.toISO(new Date(2025, 0, 1))).toBe("2025-01-01");
    expect(app.toISO(new Date(2025, 11, 31))).toBe("2025-12-31");
    expect(app.toISO(new Date(2025, 5, 9))).toBe("2025-06-09");
    expect(app.toISO(new Date(2000, 1, 29))).toBe("2000-02-29"); // leap year
  });
});

describe("parseISO()", () => {
  let app;
  beforeEach(() => { ({ app } = setupApp()); });

  test("converts a YYYY-MM-DD string to a local Date", () => {
    const d = app.parseISO("2025-06-15");
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(5); // 0-indexed
    expect(d.getDate()).toBe(15);
  });

  test("parseISO and toISO are inverse operations", () => {
    const iso = "2024-02-29";
    expect(app.toISO(app.parseISO(iso))).toBe(iso);
  });
});

describe("formatDate()", () => {
  let app;
  beforeEach(() => { ({ app } = setupApp()); });

  test("returns a human-readable string containing the year and day", () => {
    const d = new Date(2025, 5, 15);
    const result = app.formatDate(d);
    expect(result).toContain("2025");
    expect(result).toContain("15");
  });
});

// ── Name helpers ──────────────────────────────────────────────────────────────

describe("getInitials()", () => {
  let app;
  beforeEach(() => { ({ app } = setupApp()); });

  test("returns ? for empty/null/undefined input", () => {
    expect(app.getInitials("")).toBe("?");
    expect(app.getInitials(null)).toBe("?");
    expect(app.getInitials(undefined)).toBe("?");
  });

  test("returns single upper-cased initial for a single word", () => {
    expect(app.getInitials("Alex")).toBe("A");
    expect(app.getInitials("john")).toBe("J");
  });

  test("returns first + last initials for a multi-word name", () => {
    expect(app.getInitials("Alex Johnson")).toBe("AJ");
    expect(app.getInitials("Mary Jane Watson")).toBe("MW");
  });

  test("handles extra whitespace between words", () => {
    expect(app.getInitials("  Alex  Johnson  ")).toBe("AJ");
  });
});

describe("getProfileDisplayName()", () => {
  let app;
  beforeEach(() => { ({ app } = setupApp()); });

  test("returns 'Unknown' for null or undefined profile", () => {
    expect(app.getProfileDisplayName(null)).toBe("Unknown");
    expect(app.getProfileDisplayName(undefined)).toBe("Unknown");
  });

  test("prefers first_name over full_name and email", () => {
    expect(
      app.getProfileDisplayName({ first_name: "Alex", full_name: "Alex Johnson", email: "a@x.com" })
    ).toBe("Alex");
  });

  test("falls back to first word of full_name when no first_name", () => {
    expect(
      app.getProfileDisplayName({ full_name: "Alex Johnson", email: "a@x.com" })
    ).toBe("Alex");
  });

  test("falls back to email prefix when no name fields", () => {
    expect(app.getProfileDisplayName({ email: "alex@example.com" })).toBe("alex");
  });

  test("returns 'Unknown' when profile has no usable fields", () => {
    expect(app.getProfileDisplayName({})).toBe("Unknown");
  });
});

// ── Overlap / rooms logic ─────────────────────────────────────────────────────

describe("overlaps()", () => {
  let app;
  beforeEach(() => { ({ app } = setupApp()); });

  const r = (start, end) => ({
    id: "r1", start_date: start, end_date: end, rooms: 1, created_by: "u1", name: "T",
  });

  test("date within range returns true", () => {
    expect(app.overlaps(new Date(2025, 5, 15), r("2025-06-10", "2025-06-20"))).toBe(true);
  });

  test("date on start_date boundary returns true", () => {
    expect(app.overlaps(new Date(2025, 5, 10), r("2025-06-10", "2025-06-20"))).toBe(true);
  });

  test("date on end_date boundary returns true", () => {
    expect(app.overlaps(new Date(2025, 5, 20), r("2025-06-10", "2025-06-20"))).toBe(true);
  });

  test("date before range returns false", () => {
    expect(app.overlaps(new Date(2025, 5, 9), r("2025-06-10", "2025-06-20"))).toBe(false);
  });

  test("date after range returns false", () => {
    expect(app.overlaps(new Date(2025, 5, 21), r("2025-06-10", "2025-06-20"))).toBe(false);
  });

  test("single-day reservation: same day overlaps, adjacent days do not", () => {
    const single = r("2025-07-04", "2025-07-04");
    expect(app.overlaps(new Date(2025, 6, 4), single)).toBe(true);
    expect(app.overlaps(new Date(2025, 6, 3), single)).toBe(false);
    expect(app.overlaps(new Date(2025, 6, 5), single)).toBe(false);
  });
});

describe("roomsUsedOn() and reservationsOn()", () => {
  let app;
  beforeEach(() => {
    ({ app } = setupApp());
    app.state.data.reservations = [];
  });

  test("roomsUsedOn returns 0 when there are no reservations", () => {
    expect(app.roomsUsedOn(new Date(2025, 5, 15))).toBe(0);
  });

  test("roomsUsedOn sums rooms for all overlapping reservations", () => {
    app.state.data.reservations = [
      { id: "r1", start_date: "2025-06-10", end_date: "2025-06-20", rooms: 2, created_by: "u1", name: "A" },
      { id: "r2", start_date: "2025-06-12", end_date: "2025-06-18", rooms: 3, created_by: "u2", name: "B" },
    ];
    expect(app.roomsUsedOn(new Date(2025, 5, 15))).toBe(5);
  });

  test("roomsUsedOn excludes reservations that don't overlap the date", () => {
    app.state.data.reservations = [
      { id: "r1", start_date: "2025-06-10", end_date: "2025-06-14", rooms: 2, created_by: "u1", name: "A" },
      { id: "r2", start_date: "2025-06-16", end_date: "2025-06-20", rooms: 3, created_by: "u2", name: "B" },
    ];
    expect(app.roomsUsedOn(new Date(2025, 5, 15))).toBe(0);
  });

  test("reservationsOn returns all reservations that include the date", () => {
    app.state.data.reservations = [
      { id: "r1", start_date: "2025-06-10", end_date: "2025-06-20", rooms: 2, created_by: "u1", name: "A" },
      { id: "r2", start_date: "2025-06-15", end_date: "2025-06-25", rooms: 1, created_by: "u2", name: "B" },
      { id: "r3", start_date: "2025-07-01", end_date: "2025-07-10", rooms: 1, created_by: "u3", name: "C" },
    ];
    const result = app.reservationsOn(new Date(2025, 5, 15));
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual(expect.arrayContaining(["r1", "r2"]));
  });

  test("reservationsOn returns empty array when no reservations are on the date", () => {
    app.state.data.reservations = [
      { id: "r1", start_date: "2025-06-10", end_date: "2025-06-14", rooms: 2, created_by: "u1", name: "A" },
    ];
    expect(app.reservationsOn(new Date(2025, 5, 20))).toHaveLength(0);
  });
});

// ── Auth helpers ──────────────────────────────────────────────────────────────

describe("isAdmin()", () => {
  let app;
  beforeEach(() => { ({ app } = setupApp()); });

  test("returns false when profile is null", () => {
    app.state.profile = null;
    expect(app.isAdmin()).toBe(false);
  });

  test("returns false for member role", () => {
    app.state.profile = { role: "member" };
    expect(app.isAdmin()).toBe(false);
  });

  test("returns true for admin role", () => {
    app.state.profile = { role: "admin" };
    expect(app.isAdmin()).toBe(true);
  });
});

describe("canEditReservation()", () => {
  let app;
  beforeEach(() => { ({ app } = setupApp()); });

  test("returns false when user is not signed in", () => {
    app.state.user = null;
    app.state.profile = null;
    expect(app.canEditReservation({ id: "r1", created_by: "u1" })).toBe(false);
  });

  test("returns false when reservation is null", () => {
    app.state.user = { id: "u1" };
    app.state.profile = { role: "member" };
    expect(app.canEditReservation(null)).toBe(false);
  });

  test("returns true for the reservation owner", () => {
    app.state.user = { id: "u1" };
    app.state.profile = { role: "member" };
    expect(app.canEditReservation({ id: "r1", created_by: "u1" })).toBe(true);
  });

  test("returns false for a non-owner non-admin user", () => {
    app.state.user = { id: "u2" };
    app.state.profile = { role: "member" };
    expect(app.canEditReservation({ id: "r1", created_by: "u1" })).toBe(false);
  });

  test("returns true for an admin regardless of ownership", () => {
    app.state.user = { id: "admin1" };
    app.state.profile = { role: "admin" };
    expect(app.canEditReservation({ id: "r1", created_by: "u1" })).toBe(true);
  });
});

describe("getSelectedReservation()", () => {
  let app;
  beforeEach(() => { ({ app } = setupApp()); });

  test("returns null when no reservation is selected", () => {
    app.state.selectedReservationId = null;
    expect(app.getSelectedReservation()).toBeNull();
  });

  test("returns the matching reservation from state", () => {
    const r = { id: "r1", name: "Test", start_date: "2025-06-01", end_date: "2025-06-07", rooms: 2, created_by: "u1" };
    app.state.data.reservations = [r, { id: "r2", name: "Other" }];
    app.state.selectedReservationId = "r1";
    expect(app.getSelectedReservation()).toBe(r);
  });

  test("returns null when the selected ID does not exist", () => {
    app.state.data.reservations = [{ id: "r2", name: "Other" }];
    app.state.selectedReservationId = "r-missing";
    expect(app.getSelectedReservation()).toBeNull();
  });
});

describe("hasRequestedJoin()", () => {
  let app;
  beforeEach(() => { ({ app } = setupApp()); });

  test("returns false when the user has no join requests", () => {
    app.state.myJoinRequests = [];
    expect(app.hasRequestedJoin("r1")).toBe(false);
  });

  test("returns true when a pending request exists for the reservation", () => {
    app.state.myJoinRequests = [
      { reservation_id: "r1", status: "pending" },
      { reservation_id: "r2", status: "pending" },
    ];
    expect(app.hasRequestedJoin("r1")).toBe(true);
  });

  test("returns false for a different reservation", () => {
    app.state.myJoinRequests = [{ reservation_id: "r2", status: "pending" }];
    expect(app.hasRequestedJoin("r1")).toBe(false);
  });
});

// ── Calendar rendering ────────────────────────────────────────────────────────

describe("buildCalendar()", () => {
  let app;
  beforeEach(() => {
    ({ app } = setupApp());
    app.state.data.reservations = [];
    app.state.data.settings.totalRooms = 5;
    app.state.selectedDate = null;
  });

  test("renders the correct month label", () => {
    app.state.currentDate = new Date(2025, 5, 1); // June 2025
    app.buildCalendar();
    const label = document.getElementById("month-label");
    expect(label.textContent).toMatch(/June|Jun/i);
    expect(label.textContent).toContain("2025");
  });

  test("renders 42 cells for June 2025 (starts on Sunday → 6-cell offset)", () => {
    // June 2025: day=0 (Sun), offset=(0+6)%7=6, totalCells=ceil((6+30)/7)*7=42
    app.state.currentDate = new Date(2025, 5, 1);
    app.buildCalendar();
    const cells = document.getElementById("calendar-grid").querySelectorAll(".calendar-day");
    expect(cells.length).toBe(42);
  });

  test("renders 35 cells for March 2021 (starts on Monday → 0-cell offset)", () => {
    // March 2021: day=1 (Mon), offset=(1+6)%7=0, totalCells=ceil((0+31)/7)*7=35
    app.state.currentDate = new Date(2021, 2, 1);
    app.buildCalendar();
    const cells = document.getElementById("calendar-grid").querySelectorAll(".calendar-day");
    expect(cells.length).toBe(35);
  });

  test("marks days that have reservations with the has-reservation class", () => {
    app.state.currentDate = new Date(2025, 5, 1);
    app.state.data.reservations = [
      { id: "r1", start_date: "2025-06-10", end_date: "2025-06-10", rooms: 1, created_by: "u1", name: "A" },
    ];
    app.buildCalendar();
    const reserved = document.getElementById("calendar-grid").querySelectorAll(".calendar-day.has-reservation");
    expect(reserved.length).toBeGreaterThan(0);
  });

  test("marks the selected date cell with the selected class", () => {
    app.state.currentDate = new Date(2025, 5, 1);
    app.state.selectedDate = new Date(2025, 5, 15);
    app.buildCalendar();
    const selected = document.getElementById("calendar-grid").querySelectorAll(".calendar-day.selected");
    expect(selected.length).toBe(1);
    expect(selected[0].querySelector(".date-number").textContent).toBe("15");
  });

  test("does not mark any cell as selected when selectedDate is null", () => {
    app.state.currentDate = new Date(2025, 5, 1);
    app.state.selectedDate = null;
    app.buildCalendar();
    const selected = document.getElementById("calendar-grid").querySelectorAll(".calendar-day.selected");
    expect(selected.length).toBe(0);
  });
});

// ── Calendar month navigation ─────────────────────────────────────────────────

describe("Calendar month navigation logic", () => {
  let app;
  beforeEach(() => {
    ({ app } = setupApp());
    app.state.data.reservations = [];
    app.state.data.settings.totalRooms = 5;
  });

  test("going to previous month decrements the month correctly", () => {
    app.state.currentDate = new Date(2025, 5, 15); // June 2025
    app.state.currentDate = new Date(
      app.state.currentDate.getFullYear(),
      app.state.currentDate.getMonth() - 1, 1
    );
    app.buildCalendar();
    expect(document.getElementById("month-label").textContent).toMatch(/May/i);
    expect(document.getElementById("month-label").textContent).toContain("2025");
  });

  test("going to next month increments the month correctly", () => {
    app.state.currentDate = new Date(2025, 5, 15); // June 2025
    app.state.currentDate = new Date(
      app.state.currentDate.getFullYear(),
      app.state.currentDate.getMonth() + 1, 1
    );
    app.buildCalendar();
    expect(document.getElementById("month-label").textContent).toMatch(/July|Jul/i);
    expect(document.getElementById("month-label").textContent).toContain("2025");
  });

  test("wraps correctly from January to December of the previous year", () => {
    app.state.currentDate = new Date(2025, 0, 1); // January 2025
    app.state.currentDate = new Date(
      app.state.currentDate.getFullYear(),
      app.state.currentDate.getMonth() - 1, 1
    );
    app.buildCalendar();
    expect(document.getElementById("month-label").textContent).toMatch(/December|Dec/i);
    expect(document.getElementById("month-label").textContent).toContain("2024");
  });

  test("wraps correctly from December to January of the next year", () => {
    app.state.currentDate = new Date(2025, 11, 1); // December 2025
    app.state.currentDate = new Date(
      app.state.currentDate.getFullYear(),
      app.state.currentDate.getMonth() + 1, 1
    );
    app.buildCalendar();
    expect(document.getElementById("month-label").textContent).toMatch(/January|Jan/i);
    expect(document.getElementById("month-label").textContent).toContain("2026");
  });
});

// ── Selected day panel ────────────────────────────────────────────────────────

describe("renderSelectedDay()", () => {
  let app;
  beforeEach(() => {
    ({ app } = setupApp());
    app.state.user = null;
    app.state.profile = null;
    app.state.allProfiles = [];
    app.state.reservationGuests = [];
    app.state.reservationNotes = [];
    app.state.joinRequests = [];
    app.state.myJoinRequests = [];
    app.state.data.settings.totalRooms = 5;
    app.state.data.reservations = [];
  });

  test('shows "Pick a date" when no date is selected', () => {
    app.state.selectedDate = null;
    app.renderSelectedDay();
    expect(document.getElementById("selected-date").textContent).toBe("Pick a date");
  });

  test("shows the formatted date when a date is selected", () => {
    app.state.selectedDate = new Date(2025, 5, 15);
    app.renderSelectedDay();
    expect(document.getElementById("selected-date").textContent).toContain("2025");
  });

  test("shows availability information with correct counts", () => {
    app.state.selectedDate = new Date(2025, 5, 15);
    app.state.data.reservations = [
      { id: "r1", start_date: "2025-06-10", end_date: "2025-06-20", rooms: 2, created_by: "u1", name: "A" },
    ];
    app.renderSelectedDay();
    const availability = document.getElementById("availability");
    // 5 total - 2 used = 3 free
    expect(availability.textContent).toContain("3");
    expect(availability.textContent).toContain("2");
    expect(availability.textContent).toContain("5");
  });

  test("clamps available rooms to 0 when fully booked", () => {
    app.state.selectedDate = new Date(2025, 5, 15);
    app.state.data.settings.totalRooms = 3;
    app.state.data.reservations = [
      { id: "r1", start_date: "2025-06-10", end_date: "2025-06-20", rooms: 3, created_by: "u1", name: "A" },
    ];
    app.renderSelectedDay();
    expect(document.getElementById("availability").textContent).toMatch(/0\s+bedroom/i);
  });

  test("shows all reservations on the selected day", () => {
    app.state.selectedDate = new Date(2025, 5, 15);
    app.state.data.reservations = [
      { id: "r1", start_date: "2025-06-10", end_date: "2025-06-20", rooms: 2, created_by: "u1", name: "Alice" },
      { id: "r2", start_date: "2025-06-14", end_date: "2025-06-16", rooms: 1, created_by: "u2", name: "Bob" },
    ];
    app.renderSelectedDay();
    const list = document.getElementById("day-reservations");
    expect(list.textContent).toContain("Alice");
    expect(list.textContent).toContain("Bob");
  });

  test("shows 'No reservations' when the selected day has none", () => {
    app.state.selectedDate = new Date(2025, 5, 15);
    app.state.data.reservations = [];
    app.renderSelectedDay();
    expect(document.getElementById("day-reservations").textContent).toContain("No reservations");
  });
});

// ── Auth view switching ───────────────────────────────────────────────────────

describe("setAuthView()", () => {
  let app;
  beforeEach(() => { ({ app } = setupApp()); });

  test("shows sign-in form and hides others when view is 'signin'", () => {
    app.setAuthView("signin");
    expect(document.getElementById("signin-form").classList.contains("is-hidden")).toBe(false);
    expect(document.getElementById("signup-form").classList.contains("is-hidden")).toBe(true);
    expect(document.getElementById("reset-request-form").classList.contains("is-hidden")).toBe(true);
  });

  test("shows sign-up form and hides others when view is 'signup'", () => {
    app.setAuthView("signup");
    expect(document.getElementById("signup-form").classList.contains("is-hidden")).toBe(false);
    expect(document.getElementById("signin-form").classList.contains("is-hidden")).toBe(true);
    expect(document.getElementById("reset-request-form").classList.contains("is-hidden")).toBe(true);
  });

  test("sets the matching auth-tab as active", () => {
    app.setAuthView("signup");
    const activeTab = Array.from(document.querySelectorAll(".auth-tab"))
      .find((t) => t.classList.contains("is-active"));
    expect(activeTab?.dataset.authView).toBe("signup");
  });

  test("always hides the password-reset form even if it was visible", () => {
    document.getElementById("reset-request-form").classList.remove("is-hidden");
    app.setAuthView("signin");
    expect(document.getElementById("reset-request-form").classList.contains("is-hidden")).toBe(true);
  });
});

// ── Page navigation ───────────────────────────────────────────────────────────

describe("navigateTo()", () => {
  let app;
  beforeEach(() => { ({ app } = setupApp()); });

  test("activates the calendar page", () => {
    app.navigateTo("calendar");
    expect(document.getElementById("page-calendar").classList.contains("active")).toBe(true);
  });

  test("deactivates the calendar page when navigating to lists", () => {
    app.navigateTo("lists");
    expect(document.getElementById("page-lists").classList.contains("active")).toBe(true);
    expect(document.getElementById("page-calendar").classList.contains("active")).toBe(false);
  });

  test("activates the settings page", () => {
    app.navigateTo("settings");
    expect(document.getElementById("page-settings").classList.contains("active")).toBe(true);
  });

  test("marks the matching nav-item as active", () => {
    app.navigateTo("settings");
    const active = Array.from(document.querySelectorAll(".nav-item.active"));
    expect(active.some((b) => b.dataset.page === "settings")).toBe(true);
  });
});

// ── Panel tab switching ───────────────────────────────────────────────────────

describe("setPanelTab()", () => {
  let app;
  beforeEach(() => { ({ app } = setupApp()); });

  test("switches to the guests panel", () => {
    app.setPanelTab("guests");
    expect(document.getElementById("panel-guests").classList.contains("is-active")).toBe(true);
    expect(document.getElementById("panel-details").classList.contains("is-active")).toBe(false);
  });

  test("switches to the notes panel", () => {
    app.setPanelTab("notes");
    expect(document.getElementById("panel-notes").classList.contains("is-active")).toBe(true);
    expect(document.getElementById("panel-guests").classList.contains("is-active")).toBe(false);
  });

  test("switches back to the details panel", () => {
    app.setPanelTab("notes");
    app.setPanelTab("details");
    expect(document.getElementById("panel-details").classList.contains("is-active")).toBe(true);
    expect(document.getElementById("panel-notes").classList.contains("is-active")).toBe(false);
  });
});

// ── Grocery and To-Do rendering ───────────────────────────────────────────────

describe("renderGroceries()", () => {
  let app;
  beforeEach(() => {
    ({ app } = setupApp());
    app.state.user = { id: "u1" };
    app.state.profile = { role: "member" };
  });

  test("shows empty-state message when the list is empty", () => {
    app.state.data.groceries = [];
    app.renderGroceries();
    expect(document.getElementById("grocery-list").textContent).toContain("No items yet");
  });

  test("renders each grocery item", () => {
    app.state.data.groceries = [
      { id: "g1", title: "Milk", owner: "Alex", completed: false, created_by: "u1" },
      { id: "g2", title: "Bread", owner: null, completed: false, created_by: "u1" },
    ];
    app.renderGroceries();
    const list = document.getElementById("grocery-list");
    expect(list.textContent).toContain("Milk");
    expect(list.textContent).toContain("Bread");
  });

  test("marks completed items with the completed CSS class", () => {
    app.state.data.groceries = [
      { id: "g1", title: "Milk", completed: true, created_by: "u1" },
    ];
    app.renderGroceries();
    const completed = document.getElementById("grocery-list").querySelectorAll(".check-item.completed");
    expect(completed.length).toBe(1);
  });

  test("shows owner text below item title when owner is set", () => {
    app.state.data.groceries = [
      { id: "g1", title: "Eggs", owner: "Taylor", completed: false, created_by: "u1" },
    ];
    app.renderGroceries();
    expect(document.getElementById("grocery-list").textContent).toContain("Taylor");
  });
});

describe("renderTodos()", () => {
  let app;
  beforeEach(() => {
    ({ app } = setupApp());
    app.state.user = { id: "u1" };
    app.state.profile = { role: "member" };
  });

  test("shows empty-state message when the list is empty", () => {
    app.state.data.todos = [];
    app.renderTodos();
    expect(document.getElementById("todo-list").textContent).toContain("No tasks yet");
  });

  test("renders each to-do item", () => {
    app.state.data.todos = [
      { id: "t1", title: "Clean the grill", owner: "Bob", completed: false, created_by: "u1" },
    ];
    app.renderTodos();
    const list = document.getElementById("todo-list");
    expect(list.textContent).toContain("Clean the grill");
    expect(list.textContent).toContain("Bob");
  });

  test("marks completed todos with the completed CSS class", () => {
    app.state.data.todos = [
      { id: "t1", title: "Done task", completed: true, created_by: "u1" },
    ];
    app.renderTodos();
    const completed = document.getElementById("todo-list").querySelectorAll(".check-item.completed");
    expect(completed.length).toBe(1);
  });
});

// ── Auth UI state ─────────────────────────────────────────────────────────────

describe("setAuthUI()", () => {
  let app;
  beforeEach(() => {
    ({ app } = setupApp());
    // Minimal Notification mock so updatePushButtonState doesn't throw
    global.Notification = { permission: "default" };
  });

  test("shows the login screen and hides the app when signed out", () => {
    app.state.user = null;
    app.state.profile = null;
    app.setAuthUI(null);
    expect(document.getElementById("login-screen").classList.contains("is-hidden")).toBe(false);
    expect(document.getElementById("app-shell").classList.contains("is-hidden")).toBe(true);
  });

  test("hides the login screen and shows the app when signed in", () => {
    app.state.user = { id: "u1", email: "user@example.com" };
    app.state.profile = { first_name: "Alex", role: "member" };
    app.setAuthUI({ user: app.state.user });
    expect(document.getElementById("login-screen").classList.contains("is-hidden")).toBe(true);
    expect(document.getElementById("app-shell").classList.contains("is-hidden")).toBe(false);
  });

  test("shows the sign-out button when signed in", () => {
    app.state.user = { id: "u1", email: "user@example.com" };
    app.state.profile = { first_name: "Alex", role: "member" };
    app.setAuthUI({ user: app.state.user });
    expect(document.getElementById("auth-signout").classList.contains("is-hidden")).toBe(false);
  });

  test("hides the sign-out button when signed out", () => {
    app.state.user = null;
    app.state.profile = null;
    app.setAuthUI(null);
    expect(document.getElementById("auth-signout").classList.contains("is-hidden")).toBe(true);
  });

  test("displays the user's first name in the sidebar", () => {
    app.state.user = { id: "u1", email: "user@example.com" };
    app.state.profile = { first_name: "Alex", role: "member" };
    app.setAuthUI({ user: app.state.user });
    expect(document.getElementById("user-name").textContent).toBe("Alex");
  });

  test("shows bottom-nav when signed in", () => {
    app.state.user = { id: "u1" };
    app.state.profile = { first_name: "Alex", role: "member" };
    app.setAuthUI({ user: app.state.user });
    expect(document.getElementById("bottom-nav").classList.contains("is-hidden")).toBe(false);
  });
});

// ── addReservation validation ─────────────────────────────────────────────────

describe("addReservation() — client-side validation", () => {
  let app;
  beforeEach(() => {
    ({ app } = setupApp());
    app.state.user = { id: "u1", email: "user@example.com" };
    app.state.profile = { role: "member" };
    app.state.data.settings.totalRooms = 5;
    app.state.data.reservations = [];
    app.state.editingReservationId = null;
  });

  function fakeSubmitEvent(fields) {
    const form = document.getElementById("reservation-form");
    Object.entries(fields).forEach(([name, value]) => {
      const el = form.querySelector(`[name="${name}"]`);
      if (el) el.value = value;
    });
    return { preventDefault: jest.fn(), target: form };
  }

  test("shows error when check-out is before check-in", async () => {
    const ev = fakeSubmitEvent({ name: "Test", start: "2025-06-20", end: "2025-06-10", rooms: "1" });
    await app.addReservation(ev);
    expect(document.getElementById("reservation-message").textContent)
      .toContain("End date must be after start date");
  });

  test("shows error when rooms exceed the total available bedrooms", async () => {
    const ev = fakeSubmitEvent({ name: "Test", start: "2025-06-10", end: "2025-06-20", rooms: "10" });
    await app.addReservation(ev);
    expect(document.getElementById("reservation-message").textContent)
      .toContain("Rooms must be between");
  });

  test("shows error when rooms is 0", async () => {
    const ev = fakeSubmitEvent({ name: "Test", start: "2025-06-10", end: "2025-06-20", rooms: "0" });
    await app.addReservation(ev);
    expect(document.getElementById("reservation-message").textContent)
      .toContain("Rooms must be between");
  });
});

// ── Invite rendering ──────────────────────────────────────────────────────────

describe("renderInvites()", () => {
  let app;
  beforeEach(() => {
    ({ app } = setupApp());
    app.state.user = { id: "u1" };
  });

  test("shows 'No pending invites' when the invite list is empty", () => {
    app.state.invites = [];
    app.renderInvites();
    expect(document.getElementById("invites-list").textContent).toContain("No pending invites");
  });

  test("hides the invite badge when there are no invites", () => {
    app.state.invites = [];
    app.renderInvites();
    expect(document.getElementById("invite-badge").classList.contains("is-hidden")).toBe(true);
  });

  test("shows the invite badge with the correct count when invites exist", () => {
    app.state.invites = [
      {
        id: "inv1", reservation_id: "r1", created_by: "u2",
        creator_name: "Bob", start_date: "2025-07-01", end_date: "2025-07-07",
        message: null, accept_count: 0,
      },
    ];
    app.renderInvites();
    const badge = document.getElementById("invite-badge");
    expect(badge.classList.contains("is-hidden")).toBe(false);
    expect(badge.textContent).toBe("1");
  });

  test("renders invite card with join and decline action buttons", () => {
    app.state.invites = [
      {
        id: "inv1", reservation_id: "r1", created_by: "u2",
        creator_name: "Alice", start_date: "2025-07-01", end_date: "2025-07-07",
        message: "Come join us!", accept_count: 2,
      },
    ];
    app.renderInvites();
    const list = document.getElementById("invites-list");
    expect(list.querySelector("[data-action='join-invite']")).toBeTruthy();
    expect(list.querySelector("[data-action='decline-invite']")).toBeTruthy();
    expect(list.textContent).toContain("Alice");
    expect(list.textContent).toContain("Come join us!");
  });

  test("shows accept count in the invite card", () => {
    app.state.invites = [
      {
        id: "inv1", reservation_id: "r1", created_by: "u2",
        creator_name: "Alice", start_date: "2025-07-01", end_date: "2025-07-07",
        message: null, accept_count: 3,
      },
    ];
    app.renderInvites();
    const list = document.getElementById("invites-list");
    expect(list.textContent).toContain("3");
  });
});

// ── Modal visibility ──────────────────────────────────────────────────────────

describe("Join-invite modal", () => {
  let app;
  beforeEach(() => {
    ({ app } = setupApp());
    app.state.allProfiles = [];
    app.state.data.settings.totalRooms = 5;
  });

  const invite = {
    id: "inv1", creator_name: "Bob",
    start_date: "2025-07-01", end_date: "2025-07-07", message: null,
  };

  test("showJoinModal makes the modal visible and disables scroll", () => {
    app.showJoinModal(invite);
    expect(document.getElementById("join-modal").classList.contains("is-hidden")).toBe(false);
    expect(document.body.style.overflow).toBe("hidden");
  });

  test("hideJoinModal hides the modal and restores scroll", () => {
    app.showJoinModal(invite);
    app.hideJoinModal();
    expect(document.getElementById("join-modal").classList.contains("is-hidden")).toBe(true);
    expect(document.body.style.overflow).toBe("");
  });

  test("join-modal info shows the creator name and dates", () => {
    app.showJoinModal(invite);
    const info = document.getElementById("join-modal-info").textContent;
    expect(info).toContain("Bob");
    expect(info).toContain("2025"); // year from formatted date
  });
});

describe("Join-request modal", () => {
  let app;
  beforeEach(() => {
    ({ app } = setupApp());
    app.state.allProfiles = [];
    app.state.data.settings.totalRooms = 5;
  });

  const reservation = {
    id: "r1", name: "Summer Trip", occasion: null,
    start_date: "2025-07-01", end_date: "2025-07-07",
    rooms: 2, created_by: "u2",
  };

  test("showJoinRequestModal makes the modal visible", () => {
    app.showJoinRequestModal(reservation);
    expect(document.getElementById("join-request-modal").classList.contains("is-hidden")).toBe(false);
  });

  test("hideJoinRequestModal hides the modal", () => {
    app.showJoinRequestModal(reservation);
    app.hideJoinRequestModal();
    expect(document.getElementById("join-request-modal").classList.contains("is-hidden")).toBe(true);
  });

  test("join-request-modal info shows the reservation name", () => {
    app.showJoinRequestModal(reservation);
    expect(document.getElementById("join-request-modal-info").textContent).toContain("Summer Trip");
  });
});

// ── clearSignedOutState ───────────────────────────────────────────────────────

describe("clearSignedOutState()", () => {
  let app;
  beforeEach(() => { ({ app } = setupApp()); });

  test("resets all state arrays and objects to empty/null", () => {
    // Pre-populate state
    app.state.profile = { role: "admin" };
    app.state.reservationGuests = [{ id: "g1" }];
    app.state.reservationNotes = [{ id: "n1" }];
    app.state.invites = [{ id: "inv1" }];
    app.state.joinRequests = [{ id: "jr1" }];
    app.state.myJoinRequests = [{ id: "jr2" }];
    app.state.allProfiles = [{ id: "p1" }];
    app.state.data.reservations = [{ id: "r1" }];
    app.state.data.groceries = [{ id: "g2" }];
    app.state.data.todos = [{ id: "t1" }];

    app.clearSignedOutState();

    expect(app.state.profile).toBeNull();
    expect(app.state.reservationGuests).toHaveLength(0);
    expect(app.state.reservationNotes).toHaveLength(0);
    expect(app.state.invites).toHaveLength(0);
    expect(app.state.joinRequests).toHaveLength(0);
    expect(app.state.myJoinRequests).toHaveLength(0);
    expect(app.state.allProfiles).toHaveLength(0);
    expect(app.state.data.reservations).toHaveLength(0);
    expect(app.state.data.groceries).toHaveLength(0);
    expect(app.state.data.todos).toHaveLength(0);
  });
});
