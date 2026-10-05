/** App theme helpers: single source of truth for dark/light switching. */

export function currentTheme(): "dark" | "light" {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function toggleTheme(): "dark" | "light" {
  const t = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem("caliper-theme", t);
  } catch {
    /* noop */
  }
  window.dispatchEvent(new CustomEvent("ore-theme-change", { detail: t }));
  return t;
}
