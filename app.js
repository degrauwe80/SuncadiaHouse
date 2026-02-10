const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

const SUPABASE_URL = window.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || "";

let supabaseClient = null;

const state = {
  currentDate: new Date(),
  selectedDate: null,
  editingReservationId: null,
  user: null,
  profile: null,
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
  const signOut = $("#auth-signout");
  const form = $("#auth-form");

  if (signedIn) {
    const email = session.user.email || "Signed in";
    updateAuthStatus(email);
    signOut.classList.remove("is-hidden");
    form.classList.add("is-hidden");
    banner.classList.add("is-hidden");
  } else {
    updateAuthStatus("Not signed in");
    signOut.classList.add("is-hidden");
    form.classList.remove("is-hidden");
    banner.classList.remove("is-hidden");
  }

  setFormsEnabled(signedIn);
}

function setFormsEnabled(enabled) {
  const forms = [
    "#reservation-form",
    "#grocery-form",
    "#todo-form",
    "#settings-form",
  ];
  forms.forEach((selector) => {
    const form = $(selector);
    form.querySelectorAll("input, button").forEach((el) => {
      if (selector === "#settings-form" && !isAdmin()) {
        el.disabled = true;
      } else {
        el.disabled = !enabled;
      }
    });
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
    const item = document.createElement("li");
    item.className = "reservation-card";
    item.textContent = "No reservations yet.";
    list.appendChild(item);
    return;
  }

  reservations.forEach((reservation) => {
    const canEdit = state.user && (reservation.created_by === state.user.id || isAdmin());
    const item = document.createElement("li");
    item.className = "reservation-card";
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
        <button data-action="remove" data