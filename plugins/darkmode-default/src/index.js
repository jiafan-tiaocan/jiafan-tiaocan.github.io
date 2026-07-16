import { h } from "preact"

const darkmodeScript = `
const storedTheme = localStorage.getItem("theme")
const currentTheme = storedTheme === "light" || storedTheme === "dark" ? storedTheme : "dark"
document.documentElement.setAttribute("saved-theme", currentTheme)

const syncBodyThemeClass = (theme) => {
  document.body?.classList.remove("theme-dark", "theme-light")
  document.body?.classList.add(\`theme-\${theme}\`)
}

const emitThemeChangeEvent = (theme) => {
  document.dispatchEvent(new CustomEvent("themechange", { detail: { theme } }))
}

const setupDarkmodeDefault = () => {
  const savedTheme = document.documentElement.getAttribute("saved-theme") || "dark"
  syncBodyThemeClass(savedTheme)

  const switchTheme = () => {
    const nextTheme = document.documentElement.getAttribute("saved-theme") === "dark" ? "light" : "dark"
    document.documentElement.setAttribute("saved-theme", nextTheme)
    localStorage.setItem("theme", nextTheme)
    syncBodyThemeClass(nextTheme)
    emitThemeChangeEvent(nextTheme)
  }

  for (const button of document.getElementsByClassName("darkmode")) {
    button.addEventListener("click", switchTheme)
    window.addCleanup(() => button.removeEventListener("click", switchTheme))
  }
}

document.addEventListener("nav", setupDarkmodeDefault)
document.addEventListener("render", setupDarkmodeDefault)
`

const darkmodeStyles = `
.darkmode {
  position: relative;
  flex-shrink: 0;
  width: 20px;
  height: 32px;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}

.darkmode svg {
  position: absolute;
  top: calc(50% - 10px);
  left: 0;
  width: 20px;
  height: 20px;
  fill: none;
  stroke: var(--darkgray);
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

:root[saved-theme="dark"] { color-scheme: dark; }
:root[saved-theme="light"] { color-scheme: light; }
:root[saved-theme="dark"] .darkmode > .dayIcon { display: none; }
:root[saved-theme="dark"] .darkmode > .nightIcon { display: inline; }
:root[saved-theme="light"] .darkmode > .dayIcon { display: inline; }
:root[saved-theme="light"] .darkmode > .nightIcon { display: none; }
`

function DarkmodeDefault() {
  function Component({ displayClass }) {
    const className = [displayClass, "darkmode"].filter(Boolean).join(" ")

    return h(
      "button",
      { class: className, type: "button", "aria-label": "切换明暗主题" },
      h(
        "svg",
        { class: "dayIcon", viewBox: "0 0 24 24", "aria-hidden": "true" },
        h("circle", { cx: "12", cy: "12", r: "4" }),
        h("path", {
          d: "M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41",
        }),
      ),
      h(
        "svg",
        { class: "nightIcon", viewBox: "0 0 24 24", "aria-hidden": "true" },
        h("path", { d: "M20.5 15.5A9 9 0 0 1 8.5 3.5a9 9 0 1 0 12 12Z" }),
      ),
    )
  }

  Component.beforeDOMLoaded = darkmodeScript
  Component.css = darkmodeStyles
  return Component
}

export { DarkmodeDefault }
export default DarkmodeDefault
