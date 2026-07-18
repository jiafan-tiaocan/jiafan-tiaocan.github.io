import { h } from "preact"
import { formatDate } from "@quartz-community/utils/date"
import { getDate } from "@quartz-community/utils/sort"
import { resolveRelative, slugTag } from "@quartz-community/utils/path"

const defaults = {
  title: "最近写下的",
  initialLimit: 10,
  batchSize: 4,
  showTags: true,
  excerptLength: 120,
}

const contentTypes = {
  technical: { label: "技术长文" },
  thought: { label: "思考卡片" },
  life: { label: "生活与爱好" },
}

function normalizeText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : ""
}

function excerptFor(page, limit) {
  const description = normalizeText(page.frontmatter?.description ?? page.description)
  if (description) return description

  const text = normalizeText(page.text)
  const characters = Array.from(text)
  if (characters.length <= limit) return text
  return `${characters.slice(0, limit).join("")}…`
}

function datedPage(page, cfg) {
  return {
    ...page,
    defaultDateType: page.defaultDateType ?? cfg.defaultDateType,
  }
}

function pageDate(page, cfg) {
  return page.dates ? getDate(datedPage(page, cfg)) : undefined
}

function contentTypeFor(page) {
  const requestedType = page.frontmatter?.noteType
  return Object.hasOwn(contentTypes, requestedType) ? requestedType : "technical"
}

const infiniteScrollScript = `
const setupRecentNotesInfiniteScroll = () => {
  for (const container of document.querySelectorAll("[data-recent-notes-infinite]")) {
    if (container.dataset.bound === "true") continue

    const items = [...container.querySelectorAll("[data-recent-item]")]
    const loader = container.querySelector("[data-recent-loader]")
    const status = container.querySelector("[data-recent-status]")
    const button = container.querySelector("[data-recent-load-more]")
    const sentinel = container.querySelector("[data-recent-sentinel]")
    if (!loader || !status || !button || !sentinel) continue

    const batchSize = Math.max(1, Number(loader.dataset.batchSize) || 4)
    let observer

    const updateStatus = () => {
      const visibleCount = items.filter((item) => !item.hidden).length
      const complete = visibleCount >= items.length
      status.textContent = complete
        ? \`已显示全部 \${items.length} 篇\`
        : \`已显示 \${visibleCount} / \${items.length} 篇 · 下滑继续加载\`
      button.hidden = complete
      sentinel.hidden = complete
      loader.classList.toggle("is-complete", complete)
      if (complete && observer) observer.disconnect()
    }

    const revealBatch = () => {
      const nextItems = items.filter((item) => item.hidden).slice(0, batchSize)
      for (const item of nextItems) item.hidden = false
      updateStatus()
    }

    const loadMore = () => revealBatch()
    button.addEventListener("click", loadMore)

    if ("IntersectionObserver" in window) {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) revealBatch()
        },
        { rootMargin: "320px 0px" },
      )
      observer.observe(sentinel)
    }

    container.dataset.bound = "true"
    updateStatus()
    window.addCleanup(() => {
      button.removeEventListener("click", loadMore)
      if (observer) observer.disconnect()
    })
  }
}

document.addEventListener("nav", setupRecentNotesInfiniteScroll)
document.addEventListener("render", setupRecentNotesInfiniteScroll)
`

function RecentNotesSummary(userOptions = {}) {
  const options = { ...defaults, ...userOptions }

  function Component({ allFiles, cfg, displayClass, fileData }) {
    const currentSlug = fileData.slug
    const locale = cfg.locale || "zh-CN"
    const pages = allFiles
      .filter((page) => page.unlisted !== true && page.frontmatter?.publish === true)
      .sort((left, right) => {
        const dateDifference =
          (pageDate(right, cfg)?.getTime() ?? 0) - (pageDate(left, cfg)?.getTime() ?? 0)
        if (dateDifference !== 0) return dateDifference
        return String(left.frontmatter?.title ?? "").localeCompare(
          String(right.frontmatter?.title ?? ""),
          locale,
        )
      })

    const initialLimit = Math.max(1, Number(options.initialLimit) || defaults.initialLimit)
    const batchSize = Math.max(1, Number(options.batchSize) || defaults.batchSize)
    const hasMore = pages.length > initialLimit

    const className = [displayClass, "recent-notes", "with-summary"].filter(Boolean).join(" ")

    return h(
      "div",
      { class: className, "data-recent-notes-infinite": hasMore ? "" : undefined },
      h("h3", null, options.title),
      h(
        "ul",
        { class: "recent-ul" },
        pages.map((page, index) => {
          const title = page.frontmatter?.title ?? "Untitled"
          const tags = page.frontmatter?.tags ?? []
          const date = pageDate(page, cfg)
          const summary = excerptFor(page, options.excerptLength)
          const contentType = contentTypeFor(page)
          const itemClass = `recent-li content-entry content-entry--${contentType}`

          return h(
            "li",
            {
              class: itemClass,
              key: page.slug,
              hidden: hasMore && index >= initialLimit,
              "data-recent-item": "",
            },
            h(
              "div",
              { class: "section" },
              h(
                "div",
                { class: "desc" },
                h("span", { class: "content-entry__label" }, contentTypes[contentType].label),
                h(
                  "h3",
                  null,
                  h(
                    "a",
                    { href: resolveRelative(currentSlug, page.slug), class: "internal" },
                    title,
                  ),
                ),
                summary && h("p", { class: "note-summary" }, summary),
              ),
              date &&
                h(
                  "p",
                  { class: "meta" },
                  h("time", { datetime: date.toISOString() }, formatDate(date, locale)),
                ),
              options.showTags &&
                h(
                  "ul",
                  { class: "tags" },
                  tags.map((tag) =>
                    h(
                      "li",
                      { key: tag },
                      h(
                        "a",
                        {
                          class: "internal tag-link",
                          href: resolveRelative(currentSlug, `tags/${slugTag(tag)}`),
                        },
                        tag,
                      ),
                    ),
                  ),
                ),
            ),
          )
        }),
      ),
      hasMore &&
        h(
          "div",
          {
            class: "recent-notes__loader",
            "data-recent-loader": "",
            "data-batch-size": batchSize,
          },
          h(
            "p",
            {
              class: "recent-notes__status",
              role: "status",
              "aria-live": "polite",
              "data-recent-status": "",
            },
            `已显示 ${initialLimit} / ${pages.length} 篇 · 下滑继续加载`,
          ),
          h(
            "button",
            { type: "button", class: "recent-notes__more", "data-recent-load-more": "" },
            "加载更多文章",
          ),
          h("span", {
            class: "recent-notes__sentinel",
            "data-recent-sentinel": "",
            "aria-hidden": "true",
          }),
        ),
      hasMore &&
        h(
          "noscript",
          null,
          h(
            "style",
            null,
            ".recent-notes.with-summary [data-recent-item][hidden]{display:list-item!important}.recent-notes.with-summary .recent-notes__loader{display:none!important}",
          ),
        ),
    )
  }

  Component.afterDOMLoaded = infiniteScrollScript
  return Component
}

export { RecentNotesSummary }
export default RecentNotesSummary
