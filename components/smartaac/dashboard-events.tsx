"use client";

import { useState } from "react";
import { type CalendarEvent, type DemoState } from "@/lib/demo-data";
import { eventLabels, eventInfo, localIsoDate, today, cx } from "@/components/smartaac/shared";

const EVENT_EMOJI_CHOICES = ["📌", "🩺", "🦷", "🏥", "🎭", "🎨", "🎵", "🏊", "⚽", "✈️", "🚗", "🕍", "🎉", "🛒", "💇", "🐶"];

function EventsCalendar({
  events,
  selectedDate,
  onPickDate,
  onDeleteEvent,
}: {
  events: CalendarEvent[];
  selectedDate: string;
  onPickDate: (date: string) => void;
  onDeleteEvent: (eventId: string) => void;
}) {
  const [monthOffset, setMonthOffset] = useState(0);
  const now = new Date();
  now.setDate(1);
  now.setMonth(now.getMonth() + monthOffset);
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingEmptyDays = firstDay.getDay();
  const monthLabel = new Intl.DateTimeFormat("he-IL", {
    month: "long",
    year: "numeric",
  }).format(now);

  const eventsByDate = events.reduce<Record<string, CalendarEvent[]>>((grouped, event) => {
    grouped[event.date] = [...(grouped[event.date] ?? []), event];
    return grouped;
  }, {});

  const cells: Array<{ day: number | null; dateKey: string | null }> = [
    ...Array.from({ length: leadingEmptyDays }, () => ({ day: null, dateKey: null })),
    ...Array.from({ length: daysInMonth }, (_, index) => {
      const dayNumber = index + 1;
      // Built from the numbers, not toISOString(): in Israel (UTC+2/3) local
      // midnight is the previous day in UTC, which shifted every event a day.
      return {
        day: dayNumber,
        dateKey: `${year}-${String(month + 1).padStart(2, "0")}-${String(dayNumber).padStart(2, "0")}`,
      };
    }),
  ];

  return (
      <div className="mb-6 rounded-soft border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <button
            type="button"
            className="rounded-full bg-slate-100 px-3 py-1 text-lg font-black"
            onClick={() => setMonthOffset((current) => current - 1)}
            aria-label="החודש הקודם"
          >
            →
          </button>
          <h2 className="text-2xl font-black">{monthLabel}</h2>
          <button
            type="button"
            className="rounded-full bg-slate-100 px-3 py-1 text-lg font-black"
            onClick={() => setMonthOffset((current) => current + 1)}
            aria-label="החודש הבא"
          >
            ←
          </button>
          <span className="mr-auto rounded-full bg-blue-50 px-4 py-2 text-sm font-black text-blue-700">
            {events.length} אירועים
          </span>
        </div>
        <div className="mb-2 grid grid-cols-7 gap-2 text-center text-sm font-black text-muted">
          {["א", "ב", "ג", "ד", "ה", "ו", "ש"].map((day) => (
            <div key={day}>{day}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-2">
          {cells.map((cell, index) => {
            const dayEvents = cell.dateKey ? eventsByDate[cell.dateKey] ?? [] : [];
            return (
              <div
                key={`${cell.dateKey ?? "empty"}-${index}`}
                className={cx(
                  "min-h-28 rounded-2xl border border-slate-100 bg-slate-50 p-2",
                  dayEvents.length > 0 && "bg-blue-50 ring-2 ring-blue-100",
                  cell.dateKey !== null && cell.dateKey === selectedDate && "border-blue-500 ring-2 ring-blue-300",
                  cell.dateKey !== null && "cursor-pointer",
                )}
                onClick={() => cell.dateKey && onPickDate(cell.dateKey)}
                title={cell.dateKey ? "בחירת התאריך לאירוע חדש" : undefined}
              >
                {cell.day && <div className="mb-2 font-black">{cell.day}</div>}
                <div className="space-y-1">
                  {dayEvents.slice(0, 2).map((event) => (
                    <div
                      key={event.id}
                      className="flex items-center gap-1 rounded-full bg-white px-2 py-1 text-xs font-bold"
                    >
                      <span className="truncate">
                        {eventInfo(event).emoji} {event.title}
                      </span>
                      {!event.id.startsWith("holiday-") && (
                      <button
                        type="button"
                        className="mr-auto rounded-full bg-red-50 px-1 text-red-700"
                        onClick={(clickEvent) => {
                          clickEvent.stopPropagation();
                          onDeleteEvent(event.id);
                        }}
                        aria-label={`מחק ${event.title}`}
                      >
                        ×
                      </button>
                      )}
                    </div>
                  ))}
                  {dayEvents.length > 2 && (
                    <div className="text-xs font-bold text-muted">+{dayEvents.length - 2}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
  );
}

export function EventsDashboard({
  state,
  onAddEvent,
  onDeleteEvent: deleteEvent,
  update,
  holidayEvents,
}: {
  state: DemoState;
  onAddEvent: (event: Omit<CalendarEvent, "id">) => void;
  onDeleteEvent: (eventId: string) => void;
  update: (updater: (current: DemoState) => DemoState) => void;
  holidayEvents: CalendarEvent[];
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<CalendarEvent["type"]>("trip");
  const [customLabel, setCustomLabel] = useState("");
  const [customEmoji, setCustomEmoji] = useState(EVENT_EMOJI_CHOICES[0] ?? "📌");
  const [date, setDate] = useState(today());
  const [formError, setFormError] = useState("");

  const addEvent = (): void => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setFormError("הזינ/י שם לאירוע.");
      return;
    }
    if (!date) {
      setFormError("בחר/י תאריך.");
      return;
    }

    if (type === "custom" && !customLabel.trim()) {
      setFormError("הזינ/י שם לסוג האירוע, למשל: רופא שיניים.");
      return;
    }

    onAddEvent(
      type === "custom"
        ? { title: trimmedTitle, type, date, customLabel: customLabel.trim(), customEmoji }
        : { title: trimmedTitle, type, date },
    );
    setTitle("");
    setFormError("");
  };

  return (
    <section>
      <h1 className="text-3xl font-black">אירועים ולוח שנה</h1>
      <p className="mb-6 text-muted">
        האירועים של {state.activeChildName || "הילד/ה"} בלבד. הם נשמרים לכל ילד בנפרד, ומשפיעים על
        המשפטים שמוצעים לו. לחיצה על יום בלוח בוחרת אותו לאירוע חדש.
      </p>

      <div className="mb-6 rounded-soft border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-xl font-black">הוספת אירוע חדש</h2>
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
          {Object.entries(eventLabels).map(([id, item]) => (
            <button
              key={id}
              type="button"
            className={cx(
              "rounded-2xl border p-4 text-center font-black",
              type === id
                ? "border-blue-500 bg-blue-500 text-white ring-4 ring-blue-100"
                : "border-slate-200 bg-slate-50 text-slate-950",
            )}
              onClick={() => setType(id as CalendarEvent["type"])}
            >
              <span className="block text-3xl">{id === "custom" ? "➕" : item.emoji}</span>
              <span className="mt-2 block text-sm">{item.label}</span>
            </button>
          ))}
        </div>
        {type === "custom" && (
          <div className="mb-4 rounded-2xl border border-blue-100 bg-blue-50 p-4">
            <label className="grid gap-1">
              <span className="text-sm font-black">איזה סוג אירוע?</span>
              <input
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                value={customLabel}
                maxLength={30}
                onChange={(event) => setCustomLabel(event.target.value)}
                placeholder="למשל: רופא שיניים, חוג שחייה, הופעה"
              />
            </label>
            <span className="mt-3 block text-sm font-black">סמל לאירוע</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {EVENT_EMOJI_CHOICES.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className={cx(
                    "grid h-11 w-11 place-items-center rounded-xl border text-2xl",
                    customEmoji === emoji ? "border-blue-500 bg-white ring-2 ring-blue-300" : "border-slate-200 bg-white",
                  )}
                  onClick={() => setCustomEmoji(emoji)}
                  aria-label={`סמל ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="grid gap-3 lg:grid-cols-[1fr_220px_auto]">
          <input
            className="rounded-2xl border border-slate-200 px-4 py-3"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="שם האירוע, למשל: טיול לגן החיות"
          />
          <input
            className="rounded-2xl border border-slate-200 px-4 py-3"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
          <button
            type="button"
            className="rounded-2xl bg-blue-500 px-5 py-3 font-black text-white"
            onClick={addEvent}
          >
            הוספה
          </button>
        </div>
        {formError && (
          <p className="mt-3 rounded-2xl bg-red-100 px-4 py-2 text-sm font-black text-red-800">
            {formError}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            ["היום", 0],
            ["מחר", 1],
            ["בעוד שבוע", 7],
          ].map(([label, offset]) => (
            <button
              key={label}
              type="button"
              className="rounded-full bg-slate-100 px-4 py-2 text-sm font-black text-muted"
              onClick={() => {
                const nextDate = new Date();
                nextDate.setDate(nextDate.getDate() + Number(offset));
                setDate(localIsoDate(nextDate));
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <label className="mb-3 flex items-center gap-2 font-bold">
        <input
          type="checkbox"
          className="h-5 w-5"
          checked={state.showHolidays !== false}
          onChange={(event) => update((current) => ({ ...current, showHolidays: event.target.checked }))}
        />
        להציג בלוח חגים ומועדים (מתעדכן אוטומטית פעם ביום)
      </label>
      <EventsCalendar
        events={[...state.events, ...holidayEvents]}
        selectedDate={date}
        onPickDate={setDate}
        onDeleteEvent={deleteEvent}
      />

      <h2 className="mb-3 text-xl font-black">כל האירועים</h2>
      {state.events.length === 0 && (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-center font-bold text-muted">
          עוד אין אירועים. הוסיפו אירוע למעלה.
        </p>
      )}
      <div className="space-y-3">
        {[...state.events]
          .sort((left, right) => left.date.localeCompare(right.date))
          .map((event) => (
          <div key={event.id} className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4">
            <span className="text-3xl">{eventInfo(event).emoji}</span>
            <div className="flex-1">
              <div className="font-black">{event.title}</div>
              <div className="text-sm text-muted">
                {eventInfo(event).label} · {event.date}
              </div>
            </div>
            <button
              type="button"
              className="rounded-2xl bg-red-50 px-4 py-2 font-black text-red-700"
              onClick={() => deleteEvent(event.id)}
            >
              מחק
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
