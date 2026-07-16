const newTabLinksScript = `
const shouldOpenInNewTab = (anchor) => {
  const rawHref = anchor.getAttribute("href")
  if (!rawHref || rawHref.startsWith("#") || anchor.hasAttribute("download")) return false

  let destination
  try {
    destination = new URL(anchor.href, window.location.href)
  } catch {
    return false
  }

  if (destination.protocol !== "http:" && destination.protocol !== "https:") return false

  const isSamePageAnchor =
    destination.origin === window.location.origin &&
    destination.pathname === window.location.pathname &&
    destination.search === window.location.search &&
    destination.hash !== ""

  return !isSamePageAnchor
}

const markLinkForNewTab = (anchor) => {
  if (!shouldOpenInNewTab(anchor)) return
  anchor.setAttribute("target", "_blank")

  const rel = new Set((anchor.getAttribute("rel") || "").split(/\\s+/).filter(Boolean))
  rel.add("noopener")
  rel.add("noreferrer")
  anchor.setAttribute("rel", [...rel].join(" "))
}

const markLinksForNewTab = (root = document) => {
  if (root instanceof HTMLAnchorElement) markLinkForNewTab(root)
  if ("querySelectorAll" in root) {
    for (const anchor of root.querySelectorAll("a[href]")) markLinkForNewTab(anchor)
  }
}

const setupNewTabLinks = () => markLinksForNewTab(document)

document.addEventListener("nav", setupNewTabLinks)
document.addEventListener("render", setupNewTabLinks)
document.addEventListener(
  "click",
  (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const anchor = target.closest("a[href]")
    if (anchor instanceof HTMLAnchorElement) markLinkForNewTab(anchor)
  },
  true,
)

const newTabLinksObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node instanceof Element) markLinksForNewTab(node)
    }
  }
})

newTabLinksObserver.observe(document.documentElement, { childList: true, subtree: true })
`

function NewTabLinks() {
  function Component() {
    return null
  }

  Component.afterDOMLoaded = newTabLinksScript
  return Component
}

export { NewTabLinks }
export default NewTabLinks
