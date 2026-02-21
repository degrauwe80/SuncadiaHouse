// ── Helpers ────────────────────────────────────────────────
const $ = (sel, scope = document) => scope.querySelector(sel);
const $$ = (sel, scope = document) => Array.from(scope.querySelectorAll(sel));

const SUPABASE_URL = window.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || "";
const TOTAL_ROOMS_DEFAULT = 5;

let supabaseClient = null;
let pendingJoinInvite = null;
let pendingJoinRequestReservation = null;

const state = {
  currentDate: new Date(),
  selectedDate: null,
  selectedReservationId: null,
  editingReservationId: null,
  activePanel: "details",
  authView: "signin",
  user: null,
  profile: null,
  reservationGuests: [],
  reservationNotes: [],
  invites: [],
  joinRequests: [],    // pending join requests for the selected reservation (owner view)
  myJoinRequests: [],  // join requests the current user has made
  allProfiles: [],     // all registered user profiles (for guest dropdown)
  data: {
    settings: { totalRooms: TOTAL_ROOMS_DEFAULT },
    reservations: [],
    groceries: [],
    todos: [],
  },
};

// ── Supabase init ───────────────────────────────────────────
function initSupabase() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !window.supabase) {
    updateAuthStatus("Missing Supabase config. Check config.js.", true);
    return null;
  }
  return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// ── Auth helpers ────────────────────────────────────────────
function updateAuthStatus(message, isError = false) {
  const el = $("#auth-status");
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function isAdmin() {
  return state.profile?.role === "admin";
}

function getDisplayName() {
  if (state.profile?.first_name) return state.profile.first_name;
  if (state.profile?.full_name) return state.profile.full_name.split(" ")[0];
  if (state.profile?.email) return state.profile.email.split("@")[0];
  if (state.user?.email) return state.user.email.split("@")[0];
  return "Guest";
}

// Returns the best display name for any profile object
function getProfileDisplayName(profile) {
  if (!profile) return "Unknown";
  if (profile.first_name) return profile.first_name;
  if (profile.full_name) return profile.full_name.split(" ")[0];
  if (profile.email) return profile.email.split("@")[0];
  return "Unknown";
}

function getInitials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ── Date helpers ────────────────────────────────────────────
function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseISO(value) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatDate(date) {
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function overlaps(date, reservation) {
  const iso = toISO(date);
  return iso >= reservation.start_date && iso <= reservation.end_date;
}

function roomsUsedOn(date) {
  return state.data.reservations.reduce(
    (sum, r) => (overlaps(date, r) ? sum + r.rooms : sum),
    0
  );
}

function reservationsOn(date) {
  return state.data.reservations.filter((r) => overlaps(date, r));
}

function getSelectedReservation() {
  if (!state.selectedReservationId) return null;
  return state.data.reservations.find((r) => r.id === state.selectedReservationId) || null;
}

function canEditReservation(reservation) {
  if (!state.user || !reservation) return false;
  return reservation.created_by === state.user.id || isAdmin();
}

// ── UI feedback ─────────────────────────────────────────────
function showMessage(selector, message, isError = false) {
  const el = $(selector);
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? "var(--danger)" : "var(--success)";
  setTimeout(() => {
    if (el.textContent === message) el.textContent = "";
  }, 3500);
}

// ── Auth UI ─────────────────────────────────────────────────
function setAuthUI(session) {
  const signedIn = Boolean(session?.user);
  $("#auth-banner").classList.toggle("is-hidden", signedIn);
  $("#login-screen").classList.toggle("is-hidden", signedIn);
  $("#app-shell").classList.toggle("is-hidden", !signedIn);
  $("#auth-signout").classList.toggle("is-hidden", !signedIn);
  $("#bottom-nav").classList.toggle("is-hidden", !signedIn);

  if (signedIn) {
    const name = getDisplayName();
    const el = $("#user-name");
    if (el) el.textContent = name;
    const av = $("#user-avatar");
    if (av) av.textContent = getInitials(name);
    updatePushButtonState();
  }

  setFormsEnabled(signedIn);
}

function setFormsEnabled(enabled) {
  [
    "#reservation-form",
    "#guest-form",
    "#note-form",
    "#grocery-form",
    "#todo-form",
    "#settings-form",
  ].forEach((sel) => {
    const form = $(sel);
    if (!form) return;
    form.querySelectorAll("input, textarea, button, select").forEach((el) => {
      if (sel === "#settings-form" && !isAdmin()) {
        el.disabled = true;
      } else {
        el.disabled = !enabled;
      }
    });
  });
}

function setAuthView(view) {
  state.authView = view;
  $$(".auth-tab").forEach((tab) =>
    tab.classList.toggle("is-active", tab.dataset.authView === view)
  );
  $("#signin-form").classList.toggle("is-hidden", view !== "signin");
  $("#signup-form").classList.toggle("is-hidden", view !== "signup");
  $("#reset-request-form").classList.add("is-hidden");
}

// ── Navigation ──────────────────────────────────────────────
function navigateTo(page) {
  $$(".nav-item, .bottom-nav-item").forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.page === page)
  );
  $$(".page").forEach((section) =>
    section.classList.toggle("active", section.id === `page-${page}`)
  );
}

// ── Panel tabs ───────────────────────────────────────────────
function setPanelTab(panel) {
  state.activePanel = panel;
  $$(".panel-tabs .tab").forEach((tab) =>
    tab.classList.toggle("is-active", tab.dataset.panel === panel)
  );
  $$(".tab-panel").forEach((p) =>
    p.classList.toggle("is-active", p.id === `panel-${panel}`)
  );
}

// ── Calendar ─────────────────────────────────────────────────
function buildCalendar() {
  const grid = $("#calendar-grid");
  grid.innerHTML = "";

  const year = state.currentDate.getFullYear();
  const month = state.currentDate.getMonth();
  const monthStart = new Date(year, month, 1);
  const totalDays = new Date(year, month + 1, 0).getDate();

  $("#month-label").textContent = state.currentDate.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  const startOffset = (monthStart.getDay() + 6) % 7; // Mon=0
  const totalCells = Math.ceil((startOffset + totalDays) / 7) * 7;

  for (let i = 0; i < totalCells; i++) {
    const dayIdx = i - startOffset + 1;
    const date = new Date(year, month, dayIdx);
    const inMonth = dayIdx >= 1 && dayIdx <= totalDays;

    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = `calendar-day${inMonth ? "" : " muted"}`;

    const used = roomsUsedOn(date);
    const total = state.data.settings.totalRooms;

    if (used > 0) cell.classList.add("has-reservation");

    const dateNum = document.createElement("div");
    dateNum.className = "date-number";
    dateNum.textContent = String(date.getDate());

    const indicator = document.createElement("div");
    indicator.className = "cell-indicator";
    const dotCount = Math.min(total || 1, 5);
    const filledDots = total === 0 ? 0 : Math.round((Math.min(used, total) / total) * dotCount);
    for (let idx = 0; idx < dotCount; idx++) {
      const dot = document.createElement("span");
      dot.className = `dot${idx < filledDots ? " is-filled" : ""}`;
      indicator.appendChild(dot);
    }

    const bar = document.createElement("div");
    bar.className = `availability-bar${used > total ? " overbooked" : ""}`;
    const fill = document.createElement("span");
    fill.style.width = `${total === 0 ? 0 : Math.min(used / total, 1) * 100}%`;
    bar.appendChild(fill);

    if (state.selectedDate && toISO(state.selectedDate) === toISO(date)) {
      cell.classList.add("selected");
    }

    cell.append(dateNum, indicator, bar);
    cell.addEventListener("click", () => {
      state.selectedDate = date;
      renderSelectedDay();
      buildCalendar();
    });

    grid.appendChild(cell);
  }
}

// ── Selected-day panel ───────────────────────────────────────
function renderSelectedDay() {
  const output = $("#selected-date");
  const availability = $("#availability");
  const list = $("#day-reservations");

  if (!state.selectedDate) {
    output.textContent = "Pick a date";
    availability.innerHTML = "";
    list.innerHTML = "";
    return;
  }

  const reservations = reservationsOn(state.selectedDate);
  const used = roomsUsedOn(state.selectedDate);
  const total = state.data.settings.totalRooms;
  const available = total - used;

  output.textContent = formatDate(state.selectedDate);
  availability.innerHTML = `
    <span><strong>${available >= 0 ? available : 0} bedroom${available !== 1 ? "s" : ""} free</strong></span>
    <span>${used} booked · ${total} total</span>
  `;

  list.innerHTML = "";

  if (reservations.length === 0) {
    state.selectedReservationId = null;
    state.reservationGuests = [];
    state.reservationNotes = [];
    renderReservationGuests();
    renderReservationNotes();
    const li = document.createElement("li");
    li.className = "reservation-card";
    li.style.cursor = "default";
    li.textContent = "No reservations on this day.";
    list.appendChild(li);
    return;
  }

  const hasActive = reservations.some((r) => r.id === state.selectedReservationId);
  if (!hasActive) {
    state.selectedReservationId = reservations[0].id;
    loadReservationExtras();
  }

  reservations.forEach((reservation) => {
    const canEdit = canEditReservation(reservation);
    const selected = reservation.id === state.selectedReservationId;
    const alreadyRequested = hasRequestedJoin(reservation.id);

    const li = document.createElement("li");
    li.className = `reservation-card${selected ? " is-selected" : ""}`;
    li.dataset.reservationId = reservation.id;

    li.innerHTML = `
      <div class="reservation-row">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <strong>${reservation.name}</strong>
          ${reservation.occasion ? `<span class="occasion-chip">${reservation.occasion}</span>` : ""}
        </div>
        ${canEdit ? `<button type="button" class="ghost" data-action="edit" data-id="${reservation.id}" style="padding:5px 10px;font-size:.8rem">Edit</button>` : ""}
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <span class="rooms-chip">🛏 ${reservation.rooms} room${reservation.rooms !== 1 ? "s" : ""}</span>
        <span style="font-size:.8rem;color:var(--muted)">${formatDate(parseISO(reservation.start_date))} → ${formatDate(parseISO(reservation.end_date))}</span>
      </div>
      ${reservation.guests ? `<div style="font-size:.8rem;color:var(--muted)">${reservation.guests}</div>` : ""}
      ${!canEdit && state.user && !alreadyRequested ? `<div><button type="button" class="ghost request-join-btn" data-action="request-join" data-id="${reservation.id}">Request to join</button></div>` : ""}
      ${!canEdit && state.user && alreadyRequested ? `<div style="font-size:.78rem;color:var(--muted)">✓ Join request sent</div>` : ""}
    `;

    list.appendChild(li);
  });

  renderReservationGuests();
  renderReservationNotes();
}

// ── Invites render ───────────────────────────────────────────
function renderInvites() {
  const list = $("#invites-list");
  const badge = $("#invite-badge");
  list.innerHTML = "";

  if (!state.user || state.invites.length === 0) {
    badge.classList.add("is-hidden");
    const li = document.createElement("li");
    li.className = "panel-list-item";
    li.style.color = "var(--muted)";
    li.style.fontSize = ".85rem";
    li.textContent = state.user ? "No pending invites." : "Sign in to see invites.";
    list.appendChild(li);
    return;
  }

  badge.textContent = state.invites.length;
  badge.classList.remove("is-hidden");

  state.invites.forEach((invite) => {
    const creator = invite.creator_name || invite.creator_email || "Someone";
    const start = invite.start_date ? formatDate(parseISO(invite.start_date)) : "?";
    const end = invite.end_date ? formatDate(parseISO(invite.end_date)) : "?";
    const acceptCount = invite.accept_count || 0;

    const li = document.createElement("li");
    li.className = "invite-card";
    li.innerHTML = `
      <div>
        <strong>${creator}</strong> is inviting you for
        <span style="font-weight:600">${start} → ${end}</span>
      </div>
      ${invite.message ? `<div class="invite-meta">"${invite.message}"</div>` : ""}
      ${acceptCount > 0 ? `<div class="invite-responses-summary">✓ ${acceptCount} person${acceptCount !== 1 ? "s" : ""} already joining</div>` : ""}
      <div class="invite-actions">
        <button type="button" class="join-btn" data-action="join-invite" data-id="${invite.id}">Join this stay</button>
        <button type="button" class="decline-btn" data-action="decline-invite" data-id="${invite.id}">Decline</button>
      </div>
    `;
    list.appendChild(li);
  });
}

// ── Join request helpers ──────────────────────────────────────
function hasRequestedJoin(reservationId) {
  return state.myJoinRequests.some((jr) => jr.reservation_id === reservationId);
}

function renderJoinRequests() {
  const section = $("#join-requests-section");
  const badge = $("#join-requests-badge");
  const list = $("#join-requests-list");
  if (!section || !list) return;

  const selected = getSelectedReservation();
  const isOwner = selected && state.user && selected.created_by === state.user.id;

  if (!isOwner || state.joinRequests.length === 0) {
    section.classList.add("is-hidden");
    return;
  }

  section.classList.remove("is-hidden");
  if (badge) {
    badge.textContent = state.joinRequests.length;
    badge.classList.remove("is-hidden");
  }

  list.innerHTML = "";
  state.joinRequests.forEach((jr) => {
    const li = document.createElement("li");
    li.className = "invite-card";
    li.innerHTML = `
      <div>
        <strong>${jr.requester_name}</strong> wants to join &mdash;
        <span style="font-weight:600">${jr.rooms_needed} room${jr.rooms_needed !== 1 ? "s" : ""}</span>
      </div>
      ${jr.message ? `<div class="invite-meta">"${jr.message}"</div>` : ""}
      <div class="invite-actions">
        <button type="button" class="approve-btn"
          data-action="approve-join-request"
          data-id="${jr.id}"
          data-requester-id="${jr.requester_id}"
          data-requester-name="${jr.requester_name}"
          data-rooms="${jr.rooms_needed}">Approve</button>
        <button type="button" class="deny-btn"
          data-action="deny-join-request"
          data-id="${jr.id}"
          data-requester-id="${jr.requester_id}"
          data-requester-name="${jr.requester_name}">Deny</button>
      </div>
    `;
    list.appendChild(li);
  });
}

// ── Reservation guests render ────────────────────────────────
function renderReservationGuests() {
  const label = $("#selected-reservation-label");
  const list = $("#guests-list");
  const form = $("#guest-form");
  const selected = getSelectedReservation();
  const canEdit = canEditReservation(selected);

  label.textContent = selected
    ? `${selected.name} (${selected.start_date} → ${selected.end_date})`
    : "Select a reservation in Details.";

  list.innerHTML = "";

  if (!selected) {
    const li = document.createElement("li");
    li.className = "panel-list-item";
    li.textContent = "No reservation selected.";
    list.appendChild(li);
  } else if (state.reservationGuests.length === 0) {
    const li = document.createElement("li");
    li.className = "panel-list-item";
    li.style.color = "var(--muted)";
    li.style.fontSize = ".85rem";
    li.textContent = "No guests added yet.";
    list.appendChild(li);
  } else {
    state.reservationGuests.forEach((guest) => {
      const canDelete = state.user && (guest.created_by === state.user.id || isAdmin());
      const li = document.createElement("li");
      li.className = "panel-list-item";
      li.innerHTML = `
        <div>
          <strong>${guest.name}</strong>
          <div class="panel-sub">Count: ${guest.count || 1}</div>
        </div>
        ${canDelete ? `<button type="button" class="ghost" data-action="delete-guest" data-id="${guest.id}" style="padding:5px 10px;font-size:.78rem">Remove</button>` : ""}
      `;
      list.appendChild(li);
    });
  }

  form.querySelectorAll("input, button").forEach((el) => {
    el.disabled = !canEdit;
  });

  // User dropdown section
  const userGuestSection = $("#user-guest-section");
  if (userGuestSection) {
    userGuestSection.querySelectorAll("select, button").forEach((el) => {
      el.disabled = !canEdit;
    });
  }
  populateUserGuestDropdown(canEdit);
}

// ── User guest dropdown ───────────────────────────────────────
function populateUserGuestDropdown(canEdit) {
  const select = $("#user-guest-select");
  if (!select) return;

  // Keep the placeholder option; rebuild the rest
  select.innerHTML = '<option value="">— choose a user —</option>';

  if (!canEdit) return;

  const alreadyAddedIds = new Set(
    state.reservationGuests.filter((g) => g.user_id).map((g) => g.user_id)
  );

  const candidates = state.allProfiles.filter(
    (p) => p.id !== state.user?.id && !alreadyAddedIds.has(p.id)
  );

  candidates.forEach((p) => {
    const name = getProfileDisplayName(p);
    const option = document.createElement("option");
    option.value = p.id;
    option.textContent = name;
    select.appendChild(option);
  });
}

async function handleAddUserGuest() {
  if (!state.user || !state.selectedReservationId) return;
  const reservation = getSelectedReservation();
  if (!canEditReservation(reservation)) {
    showMessage("#user-guest-message", "You can only manage guests on your own reservations.", true);
    return;
  }

  const select = $("#user-guest-select");
  const userId = select?.value;
  if (!userId) {
    showMessage("#user-guest-message", "Please select a user.", true);
    return;
  }

  const profile = state.allProfiles.find((p) => p.id === userId);
  const name = getProfileDisplayName(profile);

  const { error } = await supabaseClient.from("reservation_guests").insert({
    reservation_id: state.selectedReservationId,
    name,
    count: 1,
    user_id: userId,
    created_by: state.user.id,
  });

  if (error) { showMessage("#user-guest-message", error.message, true); return; }
  if (select) select.value = "";
  showMessage("#user-guest-message", `${name} added to guest list.`);
  await loadReservationExtras();
}

// ── Reservation notes render ─────────────────────────────────
function renderReservationNotes() {
  const label = $("#notes-reservation-label");
  const list = $("#notes-list");
  const form = $("#note-form");
  const selected = getSelectedReservation();
  const canEdit = canEditReservation(selected);

  label.textContent = selected
    ? `${selected.name} (${selected.start_date} → ${selected.end_date})`
    : "Select a reservation in Details.";

  list.innerHTML = "";

  if (!selected) {
    const li = document.createElement("li");
    li.className = "panel-list-item";
    li.textContent = "No reservation selected.";
    list.appendChild(li);
  } else if (state.reservationNotes.length === 0) {
    const li = document.createElement("li");
    li.className = "panel-list-item";
    li.style.color = "var(--muted)";
    li.style.fontSize = ".85rem";
    li.textContent = "No notes yet.";
    list.appendChild(li);
  } else {
    state.reservationNotes.forEach((note) => {
      const at = new Date(note.created_at).toLocaleString();
      const canDelete = state.user && (note.created_by === state.user.id || isAdmin());
      const li = document.createElement("li");
      li.className = "panel-list-item note-item";
      li.innerHTML = `
        <div class="note-content">
          <p style="color:var(--ink)">${note.note}</p>
          <div class="panel-sub">${at}</div>
        </div>
        ${canDelete ? `<button type="button" class="ghost" data-action="delete-note" data-id="${note.id}" style="padding:5px 10px;font-size:.78rem">Delete</button>` : ""}
      `;
      list.appendChild(li);
    });
  }

  form.querySelectorAll("textarea, button").forEach((el) => {
    el.disabled = !canEdit;
  });
}

// ── Grocery & to-do renders ──────────────────────────────────
function renderGroceries() {
  const list = $("#grocery-list");
  list.innerHTML = "";
  if (state.data.groceries.length === 0) {
    const li = document.createElement("li");
    li.className = "check-item";
    li.style.color = "var(--muted)";
    li.style.fontSize = ".85rem";
    li.textContent = "No items yet. Add the first one!";
    list.appendChild(li);
    return;
  }
  state.data.groceries.forEach((item) => {
    const canEdit = state.user && (item.created_by === state.user.id || isAdmin());
    const li = document.createElement("li");
    li.className = `check-item${item.completed ? " completed" : ""}`;
    li.innerHTML = `
      <div>
        <strong>${item.title}</strong>
        ${item.owner ? `<div class="panel-sub">${item.owner}</div>` : ""}
      </div>
      ${canEdit ? `
        <div class="check-item-actions">
          <button data-action="toggle" data-id="${item.id}" data-collection="groceries" class="${item.completed ? "" : "done-btn"}">
            ${item.completed ? "Undo" : "Done"}
          </button>
          <button data-action="remove" data-id="${item.id}" data-collection="groceries">Remove</button>
        </div>
      ` : ""}
    `;
    list.appendChild(li);
  });
}

function renderTodos() {
  const list = $("#todo-list");
  list.innerHTML = "";
  if (state.data.todos.length === 0) {
    const li = document.createElement("li");
    li.className = "check-item";
    li.style.color = "var(--muted)";
    li.style.fontSize = ".85rem";
    li.textContent = "No tasks yet. Add the first one!";
    list.appendChild(li);
    return;
  }
  state.data.todos.forEach((item) => {
    const canEdit = state.user && (item.created_by === state.user.id || isAdmin());
    const li = document.createElement("li");
    li.className = `check-item${item.completed ? " completed" : ""}`;
    li.innerHTML = `
      <div>
        <strong>${item.title}</strong>
        ${item.owner ? `<div class="panel-sub">${item.owner}</div>` : ""}
      </div>
      ${canEdit ? `
        <div class="check-item-actions">
          <button data-action="toggle" data-id="${item.id}" data-collection="todos" class="${item.completed ? "" : "done-btn"}">
            ${item.completed ? "Undo" : "Done"}
          </button>
          <button data-action="remove" data-id="${item.id}" data-collection="todos">Remove</button>
        </div>
      ` : ""}
    `;
    list.appendChild(li);
  });
}

// ── Data loading ─────────────────────────────────────────────
async function loadReservationExtras() {
  if (!state.user || !state.selectedReservationId) {
    state.reservationGuests = [];
    state.reservationNotes = [];
    state.joinRequests = [];
    renderReservationGuests();
    renderReservationNotes();
    renderJoinRequests();
    return;
  }

  const [guestsRes, notesRes, jrRes] = await Promise.all([
    supabaseClient
      .from("reservation_guests")
      .select("*")
      .eq("reservation_id", state.selectedReservationId)
      .order("created_at", { ascending: true }),
    supabaseClient
      .from("reservation_notes")
      .select("*")
      .eq("reservation_id", state.selectedReservationId)
      .order("created_at", { ascending: false }),
    supabaseClient
      .from("join_requests")
      .select("*")
      .eq("reservation_id", state.selectedReservationId)
      .eq("status", "pending")
      .order("created_at", { ascending: true }),
  ]);

  if (guestsRes.error) showMessage("#guests-message", guestsRes.error.message, true);
  if (notesRes.error) showMessage("#notes-message", notesRes.error.message, true);

  state.reservationGuests = guestsRes.data || [];
  state.reservationNotes = notesRes.data || [];

  // Enrich join requests with requester names from allProfiles
  const rawJr = jrRes.data || [];
  state.joinRequests = rawJr.map((jr) => {
    const profile = state.allProfiles.find((p) => p.id === jr.requester_id);
    return { ...jr, requester_name: getProfileDisplayName(profile) };
  });

  renderReservationGuests();
  renderReservationNotes();
  renderJoinRequests();
}

async function refreshInvites() {
  if (!state.user) {
    state.invites = [];
    renderInvites();
    return;
  }

  const [invitesRes, responsesRes] = await Promise.all([
    supabaseClient.from("invites").select("*").order("created_at", { ascending: false }),
    supabaseClient
      .from("invite_responses")
      .select("invite_id, status, rooms_count")
      .eq("user_id", state.user.id),
  ]);

  if (invitesRes.error) {
    state.invites = [];
    renderInvites();
    return;
  }

  // Set of invite IDs the current user already responded to
  const respondedIds = new Set(
    (responsesRes.data || []).map((r) => r.invite_id)
  );

  // Only show invites the current user hasn't responded to and didn't create
  const pending = (invitesRes.data || []).filter(
    (inv) => !respondedIds.has(inv.id) && inv.created_by !== state.user.id
  );

  if (pending.length === 0) {
    state.invites = [];
    renderInvites();
    return;
  }

  // Enrich with reservation dates, creator names, and acceptance counts
  const reservationIds = [...new Set(pending.map((inv) => inv.reservation_id).filter(Boolean))];
  const creatorIds = [...new Set(pending.map((inv) => inv.created_by).filter(Boolean))];
  const inviteIds = pending.map((inv) => inv.id);

  const [resvRes, profileRes, acceptRes] = await Promise.all([
    reservationIds.length
      ? supabaseClient.from("reservations").select("id,start_date,end_date").in("id", reservationIds)
      : { data: [] },
    creatorIds.length
      ? supabaseClient.from("profiles").select("id,email,full_name").in("id", creatorIds)
      : { data: [] },
    supabaseClient
      .from("invite_responses")
      .select("invite_id")
      .in("invite_id", inviteIds)
      .eq("status", "accepted"),
  ]);

  const resvById = Object.fromEntries((resvRes.data || []).map((r) => [r.id, r]));
  const profileById = Object.fromEntries((profileRes.data || []).map((p) => [p.id, p]));

  // Count acceptances per invite
  const acceptCount = (acceptRes.data || []).reduce((acc, row) => {
    acc[row.invite_id] = (acc[row.invite_id] || 0) + 1;
    return acc;
  }, {});

  state.invites = pending.map((inv) => {
    const resv = resvById[inv.reservation_id] || {};
    const creator = profileById[inv.created_by] || {};
    return {
      ...inv,
      start_date: resv.start_date,
      end_date: resv.end_date,
      creator_name: creator.full_name || null,
      creator_email: creator.email || null,
      accept_count: acceptCount[inv.id] || 0,
    };
  });

  renderInvites();
}

async function refreshData() {
  if (!state.user) return;

  const [settingsRes, resvRes, grocRes, todoRes, myJrRes] = await Promise.all([
    supabaseClient.from("settings").select("*").eq("id", 1).single(),
    supabaseClient.from("reservations").select("*").order("start_date", { ascending: true }),
    supabaseClient.from("groceries").select("*").order("created_at", { ascending: false }),
    supabaseClient.from("todos").select("*").order("created_at", { ascending: false }),
    supabaseClient
      .from("join_requests")
      .select("reservation_id, status")
      .eq("requester_id", state.user.id),
  ]);

  if (!settingsRes.error && settingsRes.data) {
    state.data.settings.totalRooms = settingsRes.data.total_rooms;
    const inp = $("[name=totalRooms]", $("#settings-form"));
    if (inp) inp.value = state.data.settings.totalRooms;
  }

  state.data.reservations = resvRes.data || [];
  state.data.groceries = grocRes.data || [];
  state.data.todos = todoRes.data || [];
  state.myJoinRequests = myJrRes.data || [];

  await loadAllProfiles();

  buildCalendar();
  renderSelectedDay();
  renderGroceries();
  renderTodos();
  await refreshInvites();
}

async function fetchProfile(user) {
  if (!user) return null;
  const { data } = await supabaseClient
    .from("profiles")
    .select("id, email, role, full_name, first_name, push_subscription")
    .eq("id", user.id)
    .maybeSingle();
  return data || null;
}

async function ensureProfile(user) {
  if (!user) return;
  const fullName = user.user_metadata?.full_name || null;
  const firstName = user.user_metadata?.first_name || null;
  await supabaseClient.from("profiles").upsert({
    id: user.id,
    email: user.email,
    ...(fullName ? { full_name: fullName } : {}),
    ...(firstName ? { first_name: firstName } : {}),
  });
}

async function loadAllProfiles() {
  if (!state.user) { state.allProfiles = []; return; }
  const { data } = await supabaseClient
    .from("profiles")
    .select("id, full_name, first_name, email");
  state.allProfiles = data || [];
}

// ── Add reservation ──────────────────────────────────────────
async function addReservation(event) {
  event.preventDefault();
  if (!state.user) return;

  const form = event.target;
  const data = Object.fromEntries(new FormData(form));

  if (data.start > data.end) {
    showMessage("#reservation-message", "End date must be after start date.", true);
    return;
  }

  const rooms = Number(data.rooms);
  if (rooms < 1 || rooms > state.data.settings.totalRooms) {
    showMessage("#reservation-message", `Rooms must be between 1 and ${state.data.settings.totalRooms}.`, true);
    return;
  }

  const payload = {
    name: data.name.trim(),
    start_date: data.start,
    end_date: data.end,
    rooms,
    guests: (data.guests || "").trim() || null,
    occasion: (data.occasion || "").trim() || null,
  };

  let reservationId = state.editingReservationId;

  if (state.editingReservationId) {
    const { error } = await supabaseClient
      .from("reservations")
      .update(payload)
      .eq("id", state.editingReservationId);
    if (error) { showMessage("#reservation-message", error.message, true); return; }
    showMessage("#reservation-message", "Reservation updated.");
  } else {
    const { data: inserted, error } = await supabaseClient
      .from("reservations")
      .insert({ ...payload, created_by: state.user.id })
      .select("id")
      .single();
    if (error) { showMessage("#reservation-message", error.message, true); return; }
    reservationId = inserted.id;
    showMessage("#reservation-message", "Reservation created!");
  }

  // Send invite + notifications if requested
  if (!state.editingReservationId && data.broadcastInvite === "on" && reservationId) {
    const { error: inviteErr } = await supabaseClient.from("invites").insert({
      reservation_id: reservationId,
      created_by: state.user.id,
      message: (data.inviteNote || "").trim() || null,
    });

    if (!inviteErr) {
      const displayName = getDisplayName();
      const pushTitle = "SunEscape — New invitation!";
      const pushBody = `${displayName} created a reservation and invited you to join. Check the app!`;

      // Send push + email in the background (non-blocking)
      sendPushNotificationsToAll(pushTitle, pushBody).catch(() => {});
      sendEmailNotificationsToAll(
        `${displayName} invited you to stay at SunEscape`,
        buildInviteEmailHtml(displayName, payload.start_date, payload.end_date, data.inviteNote)
      ).catch(() => {});
    }
  }

  form.reset();
  setReservationFormMode(null);
  hideInviteNote();
  state.selectedDate = parseISO(payload.start_date);
  await refreshData();
}

function buildInviteEmailHtml(senderName, startDate, endDate, message) {
  return `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
      <h2 style="color:#0f766e">SunEscape — You're invited!</h2>
      <p><strong>${senderName}</strong> has reserved the SunEscape house and is inviting you to join.</p>
      <p><strong>Dates:</strong> ${startDate} → ${endDate}</p>
      ${message ? `<p><strong>Message:</strong> "${message}"</p>` : ""}
      <p>Open the <a href="${window.location.origin}" style="color:#0f766e">SunEscape app</a> to accept and choose how many rooms you need.</p>
    </div>
  `;
}

function buildJoinRequestEmailHtml(requesterName, reservationName, startDate, endDate, rooms, message) {
  return `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
      <h2 style="color:#0f766e">SunEscape — Join Request</h2>
      <p><strong>${requesterName}</strong> wants to join your reservation <strong>${reservationName}</strong>.</p>
      <p><strong>Dates:</strong> ${startDate} → ${endDate}</p>
      <p><strong>Rooms needed:</strong> ${rooms}</p>
      ${message ? `<p><strong>Message:</strong> "${message}"</p>` : ""}
      <p>Open the <a href="${window.location.origin}" style="color:#0f766e">SunEscape app</a> to approve or deny this request.</p>
    </div>
  `;
}

function buildJoinResponseEmailHtml(ownerName, reservationName, startDate, endDate, status) {
  const approved = status === "approved";
  return `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
      <h2 style="color:#0f766e">SunEscape — Join Request ${approved ? "Approved 🎉" : "Update"}</h2>
      <p>Your request to join <strong>${reservationName}</strong> (${startDate} → ${endDate}) has been <strong>${approved ? "approved!" : "declined."}</strong></p>
      ${approved ? "<p>You've been added to the guest list. See you at SunEscape!</p>" : "<p>The owner wasn't able to accommodate your request at this time.</p>"}
      <p>Open the <a href="${window.location.origin}" style="color:#0f766e">SunEscape app</a> for details.</p>
    </div>
  `;
}

// ── Add guest ─────────────────────────────────────────────────
async function addGuest(event) {
  event.preventDefault();
  if (!state.user || !state.selectedReservationId) return;
  const reservation = getSelectedReservation();
  if (!canEditReservation(reservation)) {
    showMessage("#guests-message", "You can only add guests to your own reservations.", true);
    return;
  }
  const data = Object.fromEntries(new FormData(event.target));
  const { error } = await supabaseClient.from("reservation_guests").insert({
    reservation_id: state.selectedReservationId,
    name: data.guestName.trim(),
    count: Number(data.guestCount) || 1,
    created_by: state.user.id,
  });
  if (error) { showMessage("#guests-message", error.message, true); return; }
  event.target.reset();
  event.target.guestCount.value = "1";
  await loadReservationExtras();
}

// ── Add note ──────────────────────────────────────────────────
async function addNote(event) {
  event.preventDefault();
  if (!state.user || !state.selectedReservationId) return;
  const reservation = getSelectedReservation();
  if (!canEditReservation(reservation)) {
    showMessage("#notes-message", "You can only add notes to your own reservations.", true);
    return;
  }
  const data = Object.fromEntries(new FormData(event.target));
  const { error } = await supabaseClient.from("reservation_notes").insert({
    reservation_id: state.selectedReservationId,
    note: data.noteText.trim(),
    created_by: state.user.id,
  });
  if (error) { showMessage("#notes-message", error.message, true); return; }
  event.target.reset();
  await loadReservationExtras();
}

// ── Grocery / todo ────────────────────────────────────────────
async function addGrocery(event) {
  event.preventDefault();
  if (!state.user) return;
  const data = Object.fromEntries(new FormData(event.target));
  const { error } = await supabaseClient.from("groceries").insert({
    title: data.item.trim(),
    owner: (data.who || "").trim() || null,
    completed: false,
    created_by: state.user.id,
  });
  if (error) return;
  event.target.reset();
  await refreshData();
}

async function addTodo(event) {
  event.preventDefault();
  if (!state.user) return;
  const data = Object.fromEntries(new FormData(event.target));
  const { error } = await supabaseClient.from("todos").insert({
    title: data.task.trim(),
    owner: (data.owner || "").trim() || null,
    completed: false,
    created_by: state.user.id,
  });
  if (error) return;
  event.target.reset();
  await refreshData();
}

async function toggleItem(collection, id) {
  const item = state.data[collection].find((e) => e.id === id);
  if (!item) return;
  await supabaseClient.from(collection).update({ completed: !item.completed }).eq("id", id);
  await refreshData();
}

async function removeItem(collection, id) {
  await supabaseClient.from(collection).delete().eq("id", id);
  await refreshData();
}

// ── Reservation form mode ─────────────────────────────────────
function setReservationFormMode(id) {
  state.editingReservationId = id;
  const submit = $("#reservation-submit");
  const cancel = $("#reservation-cancel");
  if (id) {
    submit.textContent = "Update reservation";
    cancel.classList.remove("is-hidden");
  } else {
    submit.textContent = "Reserve stay";
    cancel.classList.add("is-hidden");
  }
}

// ── Invite note toggle ────────────────────────────────────────
function hideInviteNote() {
  const wrap = $("#invite-note-wrap");
  const check = $("#broadcast-invite-check");
  if (wrap) wrap.classList.add("is-hidden");
  if (check) check.checked = false;
}

// ── Join-invite modal ─────────────────────────────────────────
function showJoinModal(invite) {
  pendingJoinInvite = invite;
  const creator = invite.creator_name || invite.creator_email || "Someone";
  const start = invite.start_date ? formatDate(parseISO(invite.start_date)) : "?";
  const end = invite.end_date ? formatDate(parseISO(invite.end_date)) : "?";

  $("#join-modal-info").innerHTML = `
    <strong>${creator}</strong> is staying at SunEscape from
    <strong>${start}</strong> to <strong>${end}</strong>.
    ${invite.message ? `<br><br>"${invite.message}"` : ""}
  `;
  $("#join-modal").classList.remove("is-hidden");
  document.body.style.overflow = "hidden";
}

function hideJoinModal() {
  pendingJoinInvite = null;
  $("#join-modal").classList.add("is-hidden");
  $("#join-modal-form").reset();
  document.body.style.overflow = "";
  showMessage("#join-modal-message", "");
}

// ── Join-request modal ────────────────────────────────────────
function showJoinRequestModal(reservation) {
  pendingJoinRequestReservation = reservation;
  const ownerProfile = state.allProfiles.find((p) => p.id === reservation.created_by);
  const ownerName = getProfileDisplayName(ownerProfile);
  const start = formatDate(parseISO(reservation.start_date));
  const end = formatDate(parseISO(reservation.end_date));

  const info = $("#join-request-modal-info");
  if (info) {
    info.innerHTML = `
      <strong>${reservation.name}</strong>${reservation.occasion ? ` &mdash; <span class="occasion-chip">${reservation.occasion}</span>` : ""}
      <br><span style="font-size:.85rem;color:var(--muted)">${start} → ${end} &middot; owned by ${ownerName}</span>
    `;
  }

  const roomsInput = $("[name=rooms]", $("#join-request-modal-form"));
  if (roomsInput) roomsInput.max = state.data.settings.totalRooms;

  $("#join-request-modal").classList.remove("is-hidden");
  document.body.style.overflow = "hidden";
}

function hideJoinRequestModal() {
  pendingJoinRequestReservation = null;
  $("#join-request-modal").classList.add("is-hidden");
  $("#join-request-modal-form").reset();
  document.body.style.overflow = "";
  showMessage("#join-request-modal-message", "");
}

async function handleJoinRequestModalSubmit(event) {
  event.preventDefault();
  if (!state.user || !pendingJoinRequestReservation) return;

  const reservation = pendingJoinRequestReservation;
  const data = Object.fromEntries(new FormData(event.target));
  const roomsNeeded = Math.max(1, Number(data.rooms) || 1);
  const message = (data.message || "").trim() || null;

  const { error } = await supabaseClient.from("join_requests").insert({
    reservation_id: reservation.id,
    requester_id: state.user.id,
    rooms_needed: roomsNeeded,
    message,
  });

  if (error) {
    const msg = error.code === "23505"
      ? "You already sent a request for this reservation."
      : error.message;
    showMessage("#join-request-modal-message", msg, true);
    return;
  }

  // Email the reservation owner
  const requesterName = getDisplayName();
  sendEmailToUser(
    reservation.created_by,
    `${requesterName} wants to join your SunEscape reservation`,
    buildJoinRequestEmailHtml(requesterName, reservation.name, reservation.start_date, reservation.end_date, roomsNeeded, message)
  ).catch(() => {});

  hideJoinRequestModal();
  showMessage("#reservation-message", "Join request sent to the owner!");
  await refreshData();
}

async function handleJoinRequestActions(event) {
  const btn = event.target.closest("button");
  if (!btn || !state.user) return;
  const { action, id, requesterId, requesterName, rooms } = btn.dataset;
  if (!action || !id) return;

  const reservation = getSelectedReservation();

  if (action === "approve-join-request") {
    if (!reservation) return;
    await supabaseClient.from("join_requests").update({ status: "approved" }).eq("id", id);
    await supabaseClient.from("reservation_guests").insert({
      reservation_id: state.selectedReservationId,
      name: requesterName || "Guest",
      count: Number(rooms) || 1,
      user_id: requesterId,
      created_by: state.user.id,
    });
    sendEmailToUser(
      requesterId,
      `Your request to join "${reservation.name}" was approved!`,
      buildJoinResponseEmailHtml(getDisplayName(), reservation.name, reservation.start_date, reservation.end_date, "approved")
    ).catch(() => {});
    showMessage("#guests-message", `${requesterName} approved and added to guests.`);
    await loadReservationExtras();
    await refreshData();
  }

  if (action === "deny-join-request") {
    await supabaseClient.from("join_requests").update({ status: "denied" }).eq("id", id);
    if (reservation) {
      sendEmailToUser(
        requesterId,
        `Update on your request to join "${reservation.name}"`,
        buildJoinResponseEmailHtml(getDisplayName(), reservation.name, reservation.start_date, reservation.end_date, "denied")
      ).catch(() => {});
    }
    await loadReservationExtras();
  }
}

async function handleJoinModalSubmit(event) {
  event.preventDefault();
  if (!state.user || !pendingJoinInvite) return;

  const invite = pendingJoinInvite;
  const data = Object.fromEntries(new FormData(event.target));
  const roomsCount = Math.max(1, Number(data.rooms) || 1);

  // Get the original reservation to copy the date range
  const original = state.data.reservations.find((r) => r.id === invite.reservation_id);
  if (!original) {
    showMessage("#join-modal-message", "Reservation not found. Please refresh.", true);
    return;
  }

  // Create the joiner's own reservation for those dates
  const { error: resvErr } = await supabaseClient.from("reservations").insert({
    name: getDisplayName(),
    start_date: original.start_date,
    end_date: original.end_date,
    rooms: roomsCount,
    created_by: state.user.id,
  });

  if (resvErr) {
    showMessage("#join-modal-message", resvErr.message, true);
    return;
  }

  // Record the invite response
  await supabaseClient.from("invite_responses").upsert(
    { invite_id: invite.id, user_id: state.user.id, status: "accepted", rooms_count: roomsCount },
    { onConflict: "invite_id,user_id" }
  );

  hideJoinModal();
  await refreshInvites();
  await refreshData();
}

// ── Push notifications ────────────────────────────────────────
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  try {
    const reg = await navigator.serviceWorker.register("/service-worker.js");
    return reg;
  } catch {
    return null;
  }
}

function updatePushButtonState() {
  const btn = $("#push-permission-btn");
  const badge = $("#push-enabled-badge");
  const statusText = $("#push-status-text");

  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    if (statusText) statusText.textContent = "Push notifications are not supported in this browser.";
    return;
  }

  const permission = Notification.permission;

  if (permission === "granted" && state.profile?.push_subscription) {
    btn?.classList.add("is-hidden");
    badge?.classList.remove("is-hidden");
    if (statusText) statusText.textContent = "You'll receive notifications for new invitations.";
  } else if (permission === "denied") {
    btn?.classList.add("is-hidden");
    badge?.classList.add("is-hidden");
    if (statusText) statusText.textContent = "Notifications are blocked. Update your browser settings to enable them.";
  } else {
    btn?.classList.remove("is-hidden");
    badge?.classList.add("is-hidden");
    if (statusText) statusText.textContent = "Enable push notifications to be alerted when someone creates a reservation.";
  }
}

async function subscribeToPush() {
  const VAPID_PUBLIC_KEY = window.VAPID_PUBLIC_KEY || "";
  if (!VAPID_PUBLIC_KEY) {
    showMessage("#push-message", "VAPID public key not configured in config.js.", true);
    return;
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    const { error } = await supabaseClient
      .from("profiles")
      .update({ push_subscription: sub.toJSON() })
      .eq("id", state.user.id);

    if (error) throw error;

    state.profile = await fetchProfile(state.user);
    updatePushButtonState();
    showMessage("#push-message", "Push notifications enabled!");
  } catch (err) {
    showMessage("#push-message", `Could not enable notifications: ${err.message}`, true);
  }
}

async function requestPushPermission() {
  if (!("Notification" in window)) {
    showMessage("#push-message", "Push notifications are not supported in this browser.", true);
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    await subscribeToPush();
  } else {
    showMessage("#push-message", "Permission denied. Enable notifications in your browser settings.", true);
    updatePushButtonState();
  }
}

async function sendPushNotificationsToAll(title, body) {
  if (!supabaseClient) return;
  try {
    await supabaseClient.functions.invoke("send-push", {
      body: { title, body, excludeUserId: state.user?.id },
    });
  } catch {
    // silently ignore — push is best-effort
  }
}

async function sendEmailNotificationsToAll(subject, html) {
  if (!supabaseClient) return;
  try {
    await supabaseClient.functions.invoke("send-email", {
      body: { subject, html, excludeUserId: state.user?.id },
    });
  } catch {
    // silently ignore — email is best-effort
  }
}

async function sendEmailToUser(targetUserId, subject, html) {
  if (!supabaseClient) return;
  try {
    await supabaseClient.functions.invoke("send-email", {
      body: { subject, html, targetUserId },
    });
  } catch {
    // silently ignore — email is best-effort
  }
}

// ── Auth actions ──────────────────────────────────────────────
async function handleSignIn(event) {
  event.preventDefault();
  if (!supabaseClient) return;
  const email = $("#signin-email").value.trim();
  const password = $("#signin-password").value;
  if (!email || !password) return;

  updateAuthStatus("Signing in…");
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) updateAuthStatus(error.message, true);
}

async function handleSignUp(event) {
  event.preventDefault();
  if (!supabaseClient) return;

  const firstName = $("#signup-first-name").value.trim();
  const lastName = $("#signup-last-name").value.trim();
  const email = $("#signup-email").value.trim();
  const password = $("#signup-password").value;
  const confirm = $("#signup-confirm-password").value;

  if (!firstName || !email || !password) {
    updateAuthStatus("Please fill in all required fields.", true);
    return;
  }
  if (password !== confirm) {
    updateAuthStatus("Passwords do not match.", true);
    return;
  }
  if (password.length < 6) {
    updateAuthStatus("Password must be at least 6 characters.", true);
    return;
  }

  const fullName = lastName ? `${firstName} ${lastName}` : firstName;

  updateAuthStatus("Creating account…");
  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName, first_name: firstName },
      emailRedirectTo: window.location.origin,
    },
  });

  if (error || !data?.user) {
    const msg = error?.message || "Signup failed. Please try again.";
    if (msg.toLowerCase().includes("email signups are disabled")) {
      updateAuthStatus("Email/password signup is disabled in Supabase Auth settings.", true);
    } else {
      updateAuthStatus(msg, true);
    }
    return;
  }

  if (data.session) {
    updateAuthStatus("Account created. Welcome to SunEscape!");
  } else {
    updateAuthStatus("Check your email to confirm your account, then sign in.");
    setAuthView("signin");
  }
}

async function handleResetRequest(event) {
  event.preventDefault();
  if (!supabaseClient) return;
  const email = $("#reset-email").value.trim();
  if (!email) return;

  updateAuthStatus("Sending reset email…");
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password.html`,
  });

  if (error) {
    updateAuthStatus(error.message, true);
  } else {
    updateAuthStatus("Reset email sent! Check your inbox.");
    $("#reset-request-form").classList.add("is-hidden");
    $("#signin-form").classList.remove("is-hidden");
  }
}

function showResetRequest() {
  $("#signin-form").classList.add("is-hidden");
  $("#signup-form").classList.add("is-hidden");
  $("#reset-request-form").classList.remove("is-hidden");
  updateAuthStatus("Enter your email address below.");
}

async function handleSignOut() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
}

function clearSignedOutState() {
  state.profile = null;
  state.selectedReservationId = null;
  state.reservationGuests = [];
  state.reservationNotes = [];
  state.invites = [];
  state.joinRequests = [];
  state.myJoinRequests = [];
  state.allProfiles = [];
  state.data.reservations = [];
  state.data.groceries = [];
  state.data.todos = [];
  buildCalendar();
  renderSelectedDay();
  renderGroceries();
  renderTodos();
  renderInvites();
}

// ── Settings ──────────────────────────────────────────────────
async function updateSettings(event) {
  event.preventDefault();
  if (!state.user || !isAdmin()) return;
  const data = Object.fromEntries(new FormData(event.target));
  const { error } = await supabaseClient
    .from("settings")
    .update({ total_rooms: Number(data.totalRooms), updated_by: state.user.id })
    .eq("id", 1);
  if (error) { showMessage("#settings-message", error.message, true); return; }
  showMessage("#settings-message", "Settings saved.");
  await refreshData();
}

// ── Event delegation ──────────────────────────────────────────
function handleListActions(event) {
  const btn = event.target.closest("button");
  if (!btn) return;
  const { action, id, collection } = btn.dataset;
  if (!action || !id || !collection) return;
  if (action === "toggle") toggleItem(collection, id);
  if (action === "remove") removeItem(collection, id);
}

function handleNav(event) {
  const btn = event.target.closest("[data-page]");
  if (!btn) return;
  navigateTo(btn.dataset.page);
}

function handleAuthTabs(event) {
  const tab = event.target.closest(".auth-tab");
  if (!tab) return;
  setAuthView(tab.dataset.authView || "signin");
}

function handlePanelTabs(event) {
  const tab = event.target.closest(".tab");
  if (!tab) return;
  setPanelTab(tab.dataset.panel || "details");
}

async function handleReservationActions(event) {
  const editBtn = event.target.closest("button[data-action='edit']");
  if (editBtn) {
    const id = editBtn.dataset.id;
    const reservation = state.data.reservations.find((r) => r.id === id);
    if (!reservation || !canEditReservation(reservation)) return;
    const form = $("#reservation-form");
    form.name.value = reservation.name;
    form.occasion.value = reservation.occasion || "";
    form.start.value = reservation.start_date;
    form.end.value = reservation.end_date;
    form.rooms.value = reservation.rooms;
    form.guests.value = reservation.guests || "";
    setReservationFormMode(id);
    state.selectedReservationId = reservation.id;
    await loadReservationExtras();
    return;
  }

  const reqBtn = event.target.closest("button[data-action='request-join']");
  if (reqBtn) {
    const id = reqBtn.dataset.id;
    const reservation = state.data.reservations.find((r) => r.id === id);
    if (reservation) showJoinRequestModal(reservation);
    return;
  }

  const card = event.target.closest("[data-reservation-id]");
  if (!card) return;
  const rid = card.dataset.reservationId;
  if (!rid || rid === state.selectedReservationId) return;
  state.selectedReservationId = rid;
  renderSelectedDay();
  await loadReservationExtras();
}

async function handleReservationExtraActions(event) {
  const btn = event.target.closest("button");
  if (!btn) return;
  const { action, id } = btn.dataset;
  if (!action || !id) return;

  if (action === "delete-guest") {
    const { error } = await supabaseClient.from("reservation_guests").delete().eq("id", id);
    if (error) { showMessage("#guests-message", error.message, true); return; }
    await loadReservationExtras();
  }
  if (action === "delete-note") {
    const { error } = await supabaseClient.from("reservation_notes").delete().eq("id", id);
    if (error) { showMessage("#notes-message", error.message, true); return; }
    await loadReservationExtras();
  }
}

async function handleInviteActions(event) {
  const btn = event.target.closest("button");
  if (!btn || !state.user) return;
  const { action, id } = btn.dataset;
  if (!action || !id) return;

  const invite = state.invites.find((inv) => inv.id === id);
  if (!invite) return;

  if (action === "join-invite") {
    showJoinModal(invite);
    return;
  }

  if (action === "decline-invite") {
    await supabaseClient.from("invite_responses").upsert(
      { invite_id: id, user_id: state.user.id, status: "declined", rooms_count: 0 },
      { onConflict: "invite_id,user_id" }
    );
    await refreshInvites();
  }
}

function handleModalActions(event) {
  const btn = event.target.closest("[data-action='close-modal']");
  if (btn) { hideJoinModal(); return; }
  const reqBtn = event.target.closest("[data-action='close-join-request-modal']");
  if (reqBtn) { hideJoinRequestModal(); return; }
}

// ── Init ──────────────────────────────────────────────────────
async function init() {
  supabaseClient = initSupabase();
  if (!supabaseClient) return;

  // Register service worker for push notifications
  registerServiceWorker().catch(() => {});

  // Auth forms
  $("#auth-tabs").addEventListener("click", handleAuthTabs);
  $("#signin-form").addEventListener("submit", handleSignIn);
  $("#signup-form").addEventListener("submit", handleSignUp);
  $("#reset-request-form").addEventListener("submit", handleResetRequest);
  $("#forgot-toggle").addEventListener("click", showResetRequest);
  $("#back-to-signin").addEventListener("click", () => setAuthView("signin"));
  $("#auth-signout").addEventListener("click", handleSignOut);

  // Reservation form
  $("#reservation-form").addEventListener("submit", addReservation);
  $("#reservation-cancel").addEventListener("click", () => {
    $("#reservation-form").reset();
    setReservationFormMode(null);
    hideInviteNote();
  });

  // Toggle invite note area when checkbox changes
  $("#broadcast-invite-check").addEventListener("change", (e) => {
    $("#invite-note-wrap").classList.toggle("is-hidden", !e.target.checked);
  });

  // Guest & note forms
  $("#guest-form").addEventListener("submit", addGuest);
  $("#note-form").addEventListener("submit", addNote);

  // Grocery & todo forms
  $("#grocery-form").addEventListener("submit", addGrocery);
  $("#todo-form").addEventListener("submit", addTodo);

  // List actions
  $("#grocery-list").addEventListener("click", handleListActions);
  $("#todo-list").addEventListener("click", handleListActions);
  $("#guests-list").addEventListener("click", handleReservationExtraActions);
  $("#notes-list").addEventListener("click", handleReservationExtraActions);
  $("#day-reservations").addEventListener("click", handleReservationActions);
  $("#invites-list").addEventListener("click", handleInviteActions);

  // Settings
  $("#settings-form").addEventListener("submit", updateSettings);
  $("#push-permission-btn").addEventListener("click", requestPushPermission);

  // Navigation (sidebar + bottom nav)
  $("#main-nav").addEventListener("click", handleNav);
  $("#bottom-nav").addEventListener("click", handleNav);

  // Panel tabs
  $(".panel-tabs").addEventListener("click", handlePanelTabs);

  // Month navigation
  $("#prev-month").addEventListener("click", () => {
    state.currentDate = new Date(state.currentDate.getFullYear(), state.currentDate.getMonth() - 1, 1);
    buildCalendar();
  });
  $("#next-month").addEventListener("click", () => {
    state.currentDate = new Date(state.currentDate.getFullYear(), state.currentDate.getMonth() + 1, 1);
    buildCalendar();
  });

  // Join-invite modal
  $("#join-modal").addEventListener("click", handleModalActions);
  $("#join-modal-form").addEventListener("submit", handleJoinModalSubmit);

  // Join-request modal
  $("#join-request-modal").addEventListener("click", handleModalActions);
  $("#join-request-modal-form").addEventListener("submit", handleJoinRequestModalSubmit);

  // Join-request approve / deny (owner actions)
  $("#join-requests-list").addEventListener("click", handleJoinRequestActions);

  // Add registered user to guest list
  $("#add-user-guest-btn").addEventListener("click", handleAddUserGuest);

  // Auth state changes
  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    state.user = session?.user || null;

    if (state.user) {
      await ensureProfile(state.user);
      state.profile = await fetchProfile(state.user);
      setAuthUI(session);
      await refreshData();
      setFormsEnabled(true);
    } else {
      setAuthUI(null);
      clearSignedOutState();
    }
  });

  // Handle password reset redirect
  const url = new URL(window.location.href);
  if (url.searchParams.get("reset") === "success") {
    updateAuthStatus("Password updated. Please sign in.");
    url.searchParams.delete("reset");
    window.history.replaceState({}, "", url.pathname);
  }

  // Initial session check
  const { data } = await supabaseClient.auth.getSession();
  state.user = data.session?.user || null;

  if (state.user) {
    await ensureProfile(state.user);
    state.profile = await fetchProfile(state.user);
  }

  setAuthView("signin");
  setPanelTab("details");
  state.selectedDate = new Date();
  setReservationFormMode(null);
  hideInviteNote();
  setAuthUI(data.session);

  if (state.user) {
    await refreshData();
  } else {
    buildCalendar();
    renderSelectedDay();
    renderInvites();
  }
}

init();
