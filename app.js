const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

const SUPABASE_URL = window.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || "";

let supabaseClient = null;

const state = {
  currentDate: new Date(),
  selectedDate: null,
  selectedReservationId: null,
  editingReservationId: null,
  activePanel: "details",
  authMode: "magic",
  user: null,
  profile: null,
  reservationGuests: [],
  reservationNotes: [],
  data: {
    settings: { totalRooms: 4 },
    reservations: [],
    groceries: [],
    todos: [],
  },
};

function initSupabase() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !window.supabase) {
    updateAuthStatus("Missing Supabase config. Set config.js.");
    return null;
  }
  const { createClient } = window.supabase;
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

function updateAuthStatus(message, isError = false) {
  const status = $("#auth-status");
  status.textContent = message;
  status.style.color = isError ? "var(--danger)" : "var(--ink)";
}

function setAuthUI(session) {
  const signedIn = Boolean(session?.user);
  const banner = $("#auth-banner");
  const loginScreen = $("#login-screen");
  const appShell = $("#app-shell");
  const signOut = $("#auth-signout");

  if (signedIn) {
    const email = session.user.email || "Signed in";
    updateAuthStatus(email);
    signOut.classList.remove("is-hidden");
    banner.classList.add("is-hidden");
    loginScreen.classList.add("is-hidden");
    appShell.classList.remove("is-hidden");
  } else {
    updateAuthStatus("Not signed in");
    signOut.classList.add("is-hidden");
    banner.classList.remove("is-hidden");
    loginScreen.classList.remove("is-hidden");
    appShell.classList.add("is-hidden");
  }

  setFormsEnabled(signedIn);
}

function setFormsEnabled(enabled) {
  const forms = [
    "#reservation-form",
    "#guest-form",
    "#note-form",
    "#grocery-form",
    "#todo-form",
    "#settings-form",
  ];
  forms.forEach((selector) => {
    const form = $(selector);
    if (!form) return;
    form.querySelectorAll("input, button").forEach((el) => {
      if (selector === "#settings-form" && !isAdmin()) {
        el.disabled = true;
      } else {
        el.disabled = !enabled;
      }
    });
    if (selector === "#note-form") {
      form.querySelectorAll("textarea").forEach((el) => {
        el.disabled = !enabled;
      });
    }
  });
}

function isAdmin() {
  return state.profile?.role === "admin";
}

function toISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseISO(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(date) {
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function overlaps(date, reservation) {
  const current = toISO(date);
  return current >= reservation.start_date && current <= reservation.end_date;
}

function roomsUsedOn(date) {
  return state.data.reservations.reduce((sum, reservation) => {
    return overlaps(date, reservation) ? sum + reservation.rooms : sum;
  }, 0);
}

function reservationsOn(date) {
  return state.data.reservations.filter((reservation) => overlaps(date, reservation));
}

function getSelectedReservation() {
  if (!state.selectedReservationId) return null;
  return state.data.reservations.find((reservation) => reservation.id === state.selectedReservationId) || null;
}

function canEditReservation(reservation) {
  if (!state.user || !reservation) return false;
  return reservation.created_by === state.user.id || isAdmin();
}

function buildCalendar() {
  const grid = $("#calendar-grid");
  grid.innerHTML = "";

  const monthStart = new Date(state.currentDate.getFullYear(), state.currentDate.getMonth(), 1);
  const monthEnd = new Date(state.currentDate.getFullYear(), state.currentDate.getMonth() + 1, 0);
  const label = state.currentDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  $("#month-label").textContent = label;

  const startOffset = (monthStart.getDay() + 6) % 7;
  const totalDays = monthEnd.getDate();
  const prevMonthDays = startOffset;
  const cells = prevMonthDays + totalDays;
  const totalCells = Math.ceil(cells / 7) * 7;

  for (let i = 0; i < totalCells; i += 1) {
    const dayIndex = i - prevMonthDays + 1;
    const date = new Date(state.currentDate.getFullYear(), state.currentDate.getMonth(), dayIndex);
    const inMonth = dayIndex >= 1 && dayIndex <= totalDays;

    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = `calendar-day${inMonth ? "" : " muted"}`;

    const dateNumber = document.createElement("div");
    dateNumber.className = "date-number";
    dateNumber.textContent = date.getDate();

    const used = roomsUsedOn(date);
    const total = state.data.settings.totalRooms;

    const indicator = document.createElement("div");
    indicator.className = "cell-indicator";

    const dotCount = Math.min(total, 4);
    const usedDots = total === 0 ? 0 : Math.round((used / total) * dotCount);
    for (let iDot = 0; iDot < dotCount; iDot += 1) {
      const dot = document.createElement("span");
      dot.className = `dot${iDot < usedDots ? " is-filled" : ""}`;
      indicator.appendChild(dot);
    }

    const bar = document.createElement("div");
    bar.className = `availability-bar${used > total ? " overbooked" : ""}`;
    const barFill = document.createElement("span");
    const percentage = total === 0 ? 0 : Math.min(Math.max(used / total, 0), 1) * 100;
    barFill.style.width = `${percentage}%`;
    bar.appendChild(barFill);

    cell.append(dateNumber, indicator, bar);

    if (state.selectedDate && toISO(state.selectedDate) === toISO(date)) {
      cell.classList.add("selected");
    }

    cell.addEventListener("click", () => {
      state.selectedDate = date;
      renderSelectedDay();
      buildCalendar();
    });

    grid.appendChild(cell);
  }
}

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
    <strong>${available} rooms available</strong>
    <span>${used} rooms booked · ${total} total</span>
  `;

  list.innerHTML = "";
  if (reservations.length === 0) {
    state.selectedReservationId = null;
    state.reservationGuests = [];
    state.reservationNotes = [];
    renderReservationGuests();
    renderReservationNotes();
    const item = document.createElement("li");
    item.className = "reservation-card";
    item.textContent = "No reservations yet.";
    list.appendChild(item);
    return;
  }

  const hasActiveReservation = reservations.some(
    (reservation) => reservation.id === state.selectedReservationId
  );
  if (!hasActiveReservation) {
    state.selectedReservationId = reservations[0].id;
    state.reservationGuests = [];
    state.reservationNotes = [];
    loadReservationExtras();
  }

  reservations.forEach((reservation) => {
    const canEdit = canEditReservation(reservation);
    const isSelected = reservation.id === state.selectedReservationId;
    const item = document.createElement("li");
    item.className = `reservation-card${isSelected ? " is-selected" : ""}`;
    item.dataset.reservationId = reservation.id;
    item.innerHTML = `
      <div class="reservation-row">
        <strong>${reservation.name}</strong>
        ${
          canEdit
            ? `<button type="button" class="ghost" data-action="edit" data-id="${
                reservation.id
              }">Edit</button>`
            : ""
        }
      </div>
      <span>${reservation.rooms} room(s)</span>
      <span>Guests: ${reservation.guests || "None"}</span>
      <span>${reservation.start_date} → ${reservation.end_date}</span>
    `;
    list.appendChild(item);
  });

  renderReservationGuests();
  renderReservationNotes();
}

function setPanelTab(panelName) {
  state.activePanel = panelName;
  $$(".panel-tabs .tab").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.panel === panelName);
  });

  $$(".tab-panel").forEach((panel) => {
    panel.classList.toggle("is-active", panel.id === `panel-${panelName}`);
  });
}

function renderReservationGuests() {
  const label = $("#selected-reservation-label");
  const list = $("#guests-list");
  const form = $("#guest-form");
  const selectedReservation = getSelectedReservation();
  const canEdit = canEditReservation(selectedReservation);

  label.textContent = selectedReservation
    ? `${selectedReservation.name} (${selectedReservation.start_date} to ${selectedReservation.end_date})`
    : "Select a reservation in Details.";

  list.innerHTML = "";
  if (!selectedReservation) {
    const li = document.createElement("li");
    li.className = "panel-list-item";
    li.textContent = "No reservation selected.";
    list.appendChild(li);
  } else if (state.reservationGuests.length === 0) {
    const li = document.createElement("li");
    li.className = "panel-list-item";
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
          <div class="panel-sub">${guest.count > 1 ? `Count: ${guest.count}` : "Count: 1"}</div>
        </div>
        ${
          canDelete
            ? `<button type="button" class="ghost" data-action="delete-guest" data-id="${guest.id}">Remove</button>`
            : ""
        }
      `;
      list.appendChild(li);
    });
  }

  form.querySelectorAll("input, button").forEach((element) => {
    element.disabled = !canEdit;
  });
}

function renderReservationNotes() {
  const label = $("#notes-reservation-label");
  const list = $("#notes-list");
  const form = $("#note-form");
  const selectedReservation = getSelectedReservation();
  const canEdit = canEditReservation(selectedReservation);

  label.textContent = selectedReservation
    ? `${selectedReservation.name} (${selectedReservation.start_date} to ${selectedReservation.end_date})`
    : "Select a reservation in Details.";

  list.innerHTML = "";
  if (!selectedReservation) {
    const li = document.createElement("li");
    li.className = "panel-list-item note-item";
    li.textContent = "No reservation selected.";
    list.appendChild(li);
  } else if (state.reservationNotes.length === 0) {
    const li = document.createElement("li");
    li.className = "panel-list-item note-item";
    li.textContent = "No notes yet.";
    list.appendChild(li);
  } else {
    state.reservationNotes.forEach((noteEntry) => {
      const createdAt = new Date(noteEntry.created_at).toLocaleString();
      const canDelete = state.user && (noteEntry.created_by === state.user.id || isAdmin());
      const li = document.createElement("li");
      li.className = "panel-list-item note-item";
      li.innerHTML = `
        <div class="note-content">
          <p>${noteEntry.note}</p>
          <div class="panel-sub">${createdAt}</div>
        </div>
        ${
          canDelete
            ? `<button type="button" class="ghost" data-action="delete-note" data-id="${noteEntry.id}">Delete</button>`
            : ""
        }
      `;
      list.appendChild(li);
    });
  }

  form.querySelectorAll("textarea, button").forEach((element) => {
    element.disabled = !canEdit;
  });
}

async function loadReservationExtras() {
  if (!state.user || !state.selectedReservationId) {
    state.reservationGuests = [];
    state.reservationNotes = [];
    renderReservationGuests();
    renderReservationNotes();
    return;
  }

  const [guestsResult, notesResult] = await Promise.all([
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
  ]);

  if (guestsResult.error) {
    showMessage("#guests-message", guestsResult.error.message, true);
  }
  if (notesResult.error) {
    showMessage("#notes-message", notesResult.error.message, true);
  }

  state.reservationGuests = guestsResult.data || [];
  state.reservationNotes = notesResult.data || [];
  renderReservationGuests();
  renderReservationNotes();
}

async function addReservation(event) {
  event.preventDefault();
  if (!state.user) return;

  const form = event.target;
  const data = Object.fromEntries(new FormData(form));

  if (data.start > data.end) {
    showMessage("#reservation-message", "End date must be after start date.", true);
    return;
  }

  const payload = {
    name: data.name.trim(),
    start_date: data.start,
    end_date: data.end,
    rooms: Number(data.rooms),
    guests: data.guests.trim(),
  };

  if (state.editingReservationId) {
    const { error } = await supabaseClient
      .from("reservations")
      .update(payload)
      .eq("id", state.editingReservationId);
    if (error) {
      showMessage("#reservation-message", error.message, true);
      return;
    }
    showMessage("#reservation-message", "Reservation updated.");
  } else {
    const { error } = await supabaseClient.from("reservations").insert({
      ...payload,
      created_by: state.user.id,
    });
    if (error) {
      showMessage("#reservation-message", error.message, true);
      return;
    }
    showMessage("#reservation-message", "Reservation added.");
  }

  form.reset();
  setReservationFormMode(null);
  state.selectedDate = parseISO(payload.start_date);
  await refreshData();
}

async function addGrocery(event) {
  event.preventDefault();
  if (!state.user) return;

  const form = event.target;
  const data = Object.fromEntries(new FormData(form));
  const item = {
    title: data.item.trim(),
    owner: data.who.trim(),
    completed: false,
    created_by: state.user.id,
  };

  const { error } = await supabaseClient.from("groceries").insert(item);
  if (error) {
    showMessage("#settings-message", error.message, true);
    return;
  }

  form.reset();
  await refreshData();
}

async function addTodo(event) {
  event.preventDefault();
  if (!state.user) return;

  const form = event.target;
  const data = Object.fromEntries(new FormData(form));
  const item = {
    title: data.task.trim(),
    owner: data.owner.trim(),
    completed: false,
    created_by: state.user.id,
  };

  const { error } = await supabaseClient.from("todos").insert(item);
  if (error) {
    showMessage("#settings-message", error.message, true);
    return;
  }

  form.reset();
  await refreshData();
}

async function addGuest(event) {
  event.preventDefault();
  if (!state.user || !state.selectedReservationId) return;

  const selectedReservation = getSelectedReservation();
  if (!canEditReservation(selectedReservation)) {
    showMessage("#guests-message", "You can only add guests to reservations you can edit.", true);
    return;
  }

  const form = event.target;
  const data = Object.fromEntries(new FormData(form));

  const { error } = await supabaseClient.from("reservation_guests").insert({
    reservation_id: state.selectedReservationId,
    name: data.guestName.trim(),
    count: Number(data.guestCount) || 1,
    created_by: state.user.id,
  });

  if (error) {
    showMessage("#guests-message", error.message, true);
    return;
  }

  form.reset();
  form.guestCount.value = "1";
  showMessage("#guests-message", "Guest added.");
  await loadReservationExtras();
}

async function addNote(event) {
  event.preventDefault();
  if (!state.user || !state.selectedReservationId) return;

  const selectedReservation = getSelectedReservation();
  if (!canEditReservation(selectedReservation)) {
    showMessage("#notes-message", "You can only add notes to reservations you can edit.", true);
    return;
  }

  const form = event.target;
  const data = Object.fromEntries(new FormData(form));

  const { error } = await supabaseClient.from("reservation_notes").insert({
    reservation_id: state.selectedReservationId,
    note: data.noteText.trim(),
    created_by: state.user.id,
  });

  if (error) {
    showMessage("#notes-message", error.message, true);
    return;
  }

  form.reset();
  showMessage("#notes-message", "Note added.");
  await loadReservationExtras();
}

async function toggleItem(collection, id) {
  const existing = state.data[collection].find((entry) => entry.id === id);
  if (!existing) return;

  const { error } = await supabaseClient
    .from(collection)
    .update({ completed: !existing.completed })
    .eq("id", id);
  if (error) return;
  await refreshData();
}

async function removeItem(collection, id) {
  const { error } = await supabaseClient.from(collection).delete().eq("id", id);
  if (error) return;
  await refreshData();
}

function renderGroceries() {
  const list = $("#grocery-list");
  list.innerHTML = "";

  state.data.groceries.forEach((item) => {
    const canEdit = state.user && (item.created_by === state.user.id || isAdmin());
    const li = document.createElement("li");
    li.className = `check-item${item.completed ? " completed" : ""}`;
    li.innerHTML = `
      <div>
        <strong>${item.title}</strong>
        <div class="panel-sub">${item.owner || "Unassigned"}</div>
      </div>
      <div>
        ${
          canEdit
            ? `<button data-action="toggle" data-id="${item.id}" data-collection="groceries">${
                item.completed ? "Undo" : "Done"
              }</button>
        <button data-action="remove" data-id="${item.id}" data-collection="groceries">Remove</button>`
            : ""
        }
      </div>
    `;
    list.appendChild(li);
  });
}

function renderTodos() {
  const list = $("#todo-list");
  list.innerHTML = "";

  state.data.todos.forEach((item) => {
    const canEdit = state.user && (item.created_by === state.user.id || isAdmin());
    const li = document.createElement("li");
    li.className = `check-item${item.completed ? " completed" : ""}`;
    li.innerHTML = `
      <div>
        <strong>${item.title}</strong>
        <div class="panel-sub">${item.owner || "Unassigned"}</div>
      </div>
      <div>
        ${
          canEdit
            ? `<button data-action="toggle" data-id="${item.id}" data-collection="todos">${
                item.completed ? "Undo" : "Done"
              }</button>
        <button data-action="remove" data-id="${item.id}" data-collection="todos">Remove</button>`
            : ""
        }
      </div>
    `;
    list.appendChild(li);
  });
}

function showMessage(selector, message, isError = false) {
  const element = $(selector);
  element.textContent = message;
  element.style.color = isError ? "var(--danger)" : "var(--muted)";
  setTimeout(() => {
    element.textContent = "";
  }, 2800);
}

function handleListActions(event) {
  const button = event.target.closest("button");
  if (!button) return;
  const { action, id, collection } = button.dataset;
  if (!action || !id || !collection) return;

  if (action === "toggle") {
    toggleItem(collection, id);
  }

  if (action === "remove") {
    removeItem(collection, id);
  }
}

async function handleReservationExtraActions(event) {
  const button = event.target.closest("button");
  if (!button) return;
  const { action, id } = button.dataset;
  if (!action || !id) return;

  if (action === "delete-guest") {
    const { error } = await supabaseClient.from("reservation_guests").delete().eq("id", id);
    if (error) {
      showMessage("#guests-message", error.message, true);
      return;
    }
    await loadReservationExtras();
  }

  if (action === "delete-note") {
    const { error } = await supabaseClient.from("reservation_notes").delete().eq("id", id);
    if (error) {
      showMessage("#notes-message", error.message, true);
      return;
    }
    await loadReservationExtras();
  }
}

async function handleReservationActions(event) {
  const button = event.target.closest("button");
  if (button) {
    const { action, id } = button.dataset;
    if (action === "edit" && id) {
      const reservation = state.data.reservations.find((entry) => entry.id === id);
      if (!reservation) return;
      if (!canEditReservation(reservation)) return;

      const form = $("#reservation-form");
      form.name.value = reservation.name;
      form.start.value = reservation.start_date;
      form.end.value = reservation.end_date;
      form.rooms.value = reservation.rooms;
      form.guests.value = reservation.guests || "";
      setReservationFormMode(id);
      state.selectedReservationId = reservation.id;
      await loadReservationExtras();
      return;
    }
  }

  const reservationItem = event.target.closest("[data-reservation-id]");
  if (!reservationItem) return;
  const reservationId = reservationItem.dataset.reservationId;
  if (!reservationId || state.selectedReservationId === reservationId) return;

  state.selectedReservationId = reservationId;
  renderSelectedDay();
  await loadReservationExtras();
}

function handlePanelTabs(event) {
  const tab = event.target.closest(".tab");
  if (!tab) return;
  const panel = tab.dataset.panel;
  if (!panel) return;
  setPanelTab(panel);
}

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

function handleNav(event) {
  const button = event.target.closest(".nav-item");
  if (!button) return;
  const page = button.dataset.page;
  if (!page) return;

  $$(".nav-item").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");

  $$(".page").forEach((section) => section.classList.remove("active"));
  $("#page-" + page).classList.add("active");
}

async function updateSettings(event) {
  event.preventDefault();
  if (!state.user || !isAdmin()) return;
  const form = event.target;
  const data = Object.fromEntries(new FormData(form));
  const { error } = await supabaseClient
    .from("settings")
    .update({ total_rooms: Number(data.totalRooms), updated_by: state.user.id })
    .eq("id", 1);
  if (error) {
    showMessage("#settings-message", error.message, true);
    return;
  }
  await refreshData();
  showMessage("#settings-message", "Settings saved.");
}

async function fetchProfile(user) {
  if (!user) return null;
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, email, role")
    .eq("id", user.id)
    .maybeSingle();

  if (error) return null;
  return data;
}

async function ensureProfile(user) {
  if (!user) return;
  await supabaseClient.from("profiles").upsert({ id: user.id, email: user.email });
}

async function refreshData() {
  if (!state.user) return;

  const [settingsResult, reservationsResult, groceriesResult, todosResult] = await Promise.all([
    supabaseClient.from("settings").select("*").eq("id", 1).single(),
    supabaseClient.from("reservations").select("*").order("start_date", { ascending: true }),
    supabaseClient.from("groceries").select("*").order("created_at", { ascending: false }),
    supabaseClient.from("todos").select("*").order("created_at", { ascending: false }),
  ]);

  if (!settingsResult.error && settingsResult.data) {
    state.data.settings.totalRooms = settingsResult.data.total_rooms;
    const settingsInput = $("#settings-form [name=totalRooms]");
    settingsInput.value = state.data.settings.totalRooms;
  }

  state.data.reservations = reservationsResult.data || [];
  state.data.groceries = groceriesResult.data || [];
  state.data.todos = todosResult.data || [];

  buildCalendar();
  renderSelectedDay();
  renderGroceries();
  renderTodos();
}

async function handleAuthForm(event) {
  event.preventDefault();
  if (!supabaseClient) return;
  const email = $("#magic-email").value.trim();
  if (!email) return;
  const { error } = await supabaseClient.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: window.location.origin,
    },
  });
  if (error) {
    updateAuthStatus(error.message, true);
  } else {
    updateAuthStatus("Magic link sent.");
  }
}

async function handlePasswordAuthForm(event) {
  event.preventDefault();
  if (!supabaseClient) return;
  const email = $("#password-email").value.trim();
  const password = $("#password-value").value;
  if (!email || !password) return;

  const { error } = await supabaseClient.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    updateAuthStatus(error.message, true);
  } else {
    updateAuthStatus("Signing you in...");
  }
}

function setAuthMode(mode) {
  state.authMode = mode;
  const magicForm = $("#auth-magic-form");
  const passwordForm = $("#auth-password-form");
  const tabs = $$(".auth-tab");

  tabs.forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.authMode === mode);
  });

  if (mode === "password") {
    magicForm.classList.add("is-hidden");
    passwordForm.classList.remove("is-hidden");
  } else {
    passwordForm.classList.add("is-hidden");
    magicForm.classList.remove("is-hidden");
  }
}

function handleAuthModeSwitch(event) {
  const button = event.target.closest(".auth-tab");
  if (!button) return;
  const mode = button.dataset.authMode;
  if (!mode) return;
  setAuthMode(mode);
}

async function handleSignOut() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
}

async function init() {
  supabaseClient = initSupabase();
  if (!supabaseClient) return;

  $("#auth-tabs").addEventListener("click", handleAuthModeSwitch);
  $("#auth-magic-form").addEventListener("submit", handleAuthForm);
  $("#auth-password-form").addEventListener("submit", handlePasswordAuthForm);
  $("#auth-signout").addEventListener("click", handleSignOut);

  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    state.user = session?.user || null;
    setAuthUI(session);

    if (state.user) {
      await ensureProfile(state.user);
      state.profile = await fetchProfile(state.user);
      await refreshData();
      setFormsEnabled(true);
    } else {
      state.profile = null;
      state.selectedReservationId = null;
      state.reservationGuests = [];
      state.reservationNotes = [];
      state.data.reservations = [];
      state.data.groceries = [];
      state.data.todos = [];
      buildCalendar();
      renderSelectedDay();
      renderGroceries();
      renderTodos();
    }
  });

  const { data } = await supabaseClient.auth.getSession();
  state.user = data.session?.user || null;
  if (state.user) {
    await ensureProfile(state.user);
    state.profile = await fetchProfile(state.user);
  }

  setAuthUI(data.session);
  setAuthMode("magic");
  setPanelTab("details");
  state.selectedDate = new Date();
  setReservationFormMode(null);

  if (state.user) {
    await refreshData();
  } else {
    buildCalendar();
    renderSelectedDay();
  }

  $("#reservation-form").addEventListener("submit", addReservation);
  $("#reservation-cancel").addEventListener("click", () => {
    $("#reservation-form").reset();
    setReservationFormMode(null);
  });
  $("#grocery-form").addEventListener("submit", addGrocery);
  $("#todo-form").addEventListener("submit", addTodo);
  $("#guest-form").addEventListener("submit", addGuest);
  $("#note-form").addEventListener("submit", addNote);
  $("#grocery-list").addEventListener("click", handleListActions);
  $("#todo-list").addEventListener("click", handleListActions);
  $("#guests-list").addEventListener("click", handleReservationExtraActions);
  $("#notes-list").addEventListener("click", handleReservationExtraActions);
  $("#settings-form").addEventListener("submit", updateSettings);
  $(".nav").addEventListener("click", handleNav);
  $(".panel-tabs").addEventListener("click", handlePanelTabs);
  $("#day-reservations").addEventListener("click", handleReservationActions);

  $("#prev-month").addEventListener("click", () => {
    state.currentDate = new Date(state.currentDate.getFullYear(), state.currentDate.getMonth() - 1, 1);
    buildCalendar();
  });

  $("#next-month").addEventListener("click", () => {
    state.currentDate = new Date(state.currentDate.getFullYear(), state.currentDate.getMonth() + 1, 1);
    buildCalendar();
  });
}

init();
