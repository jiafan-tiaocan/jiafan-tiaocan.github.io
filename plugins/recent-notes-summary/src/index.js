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
  chartMonths: 24,
}

const contentTypes = {
  technical: { label: "技术长文" },
  paper: { label: "论文解读" },
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

function monthKey(date) {
  if (!date) return ""
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, "0")
  return `${year}-${month}`
}

function monthLabel(key, locale) {
  const [year, month] = key.split("-").map(Number)
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)))
}

function recentMonthKeys(count) {
  const today = new Date()
  const current = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(
      Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - (count - index - 1), 1),
    )
    return monthKey(date)
  })
}

function publicationTimeline(pages, cfg, locale, count) {
  const months = recentMonthKeys(count).map((key) => ({
    key,
    label: monthLabel(key, locale),
    counts: Object.fromEntries(Object.keys(contentTypes).map((type) => [type, 0])),
    titles: [],
    total: 0,
  }))
  const byMonth = new Map(months.map((month) => [month.key, month]))

  for (const page of pages) {
    const date = pageDate(page, cfg)
    const month = byMonth.get(monthKey(date))
    if (!month) continue
    const contentType = contentTypeFor(page)
    month.counts[contentType] += 1
    month.total += 1
    month.titles.push(String(page.frontmatter?.title ?? "Untitled"))
  }

  return months
}

const recentNotesScript = `
const setupRecentNotes = () => {
  for (const container of document.querySelectorAll("[data-recent-notes]")) {
    if (container.dataset.bound === "true") continue

    const items = [...container.querySelectorAll("[data-recent-item]")]
    const loader = container.querySelector("[data-recent-loader]")
    const status = container.querySelector("[data-recent-status]")
    const button = container.querySelector("[data-recent-load-more]")
    const sentinel = container.querySelector("[data-recent-sentinel]")
    const chart = container.querySelector("[data-publication-chart]")
    const chartStatus = container.querySelector("[data-publication-chart-status]")
    const clearFilter = container.querySelector("[data-publication-chart-clear]")
    const monthButtons = [...container.querySelectorAll("[data-publication-month]")]
    const tooltip = container.querySelector("[data-publication-tooltip]")
    const initialLimit = Math.max(1, Number(container.dataset.initialLimit) || 10)
    const batchSize = Math.max(1, Number(container.dataset.batchSize) || 4)
    let visibleLimit = initialLimit
    let activeMonth = ""
    let observer

    const updateStatus = () => {
      if (activeMonth) {
        const selected = monthButtons.find((month) => month.dataset.month === activeMonth)
        const matchingCount = items.filter((item) => item.dataset.month === activeMonth).length
        if (chartStatus && selected) {
          chartStatus.textContent = \`\${selected.dataset.label} · \${matchingCount} 篇\`
        }
        if (loader) loader.hidden = true
        return
      }

      if (chartStatus) chartStatus.textContent = chartStatus.dataset.defaultText || ""
      if (!loader || !status || !button || !sentinel) return
      loader.hidden = false
      const visibleCount = items.filter((item, index) => !item.hidden && index < visibleLimit).length
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
      if (activeMonth) return
      visibleLimit = Math.min(items.length, visibleLimit + batchSize)
      items.forEach((item, index) => {
        item.hidden = index >= visibleLimit
      })
      updateStatus()
    }

    const loadMore = () => revealBatch()
    if (button) button.addEventListener("click", loadMore)

    if (sentinel && "IntersectionObserver" in window) {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) revealBatch()
        },
        { rootMargin: "320px 0px" },
      )
      observer.observe(sentinel)
    }

    const applyMonthFilter = (month) => {
      activeMonth = activeMonth === month ? "" : month
      items.forEach((item, index) => {
        item.hidden = activeMonth ? item.dataset.month !== activeMonth : index >= visibleLimit
      })
      for (const monthButton of monthButtons) {
        const selected = Boolean(activeMonth) && monthButton.dataset.month === activeMonth
        monthButton.setAttribute("aria-pressed", String(selected))
      }
      if (clearFilter) clearFilter.hidden = !activeMonth
      container.toggleAttribute("data-month-filtered", Boolean(activeMonth))
      updateStatus()
    }

    const clearMonthFilter = () => {
      if (activeMonth) applyMonthFilter(activeMonth)
    }

    const showTooltip = (monthButton) => {
      if (!tooltip || !chart) return
      let titles = []
      try {
        titles = JSON.parse(monthButton.dataset.titles || "[]")
      } catch {
        titles = []
      }
      const heading = document.createElement("strong")
      heading.textContent = \`\${monthButton.dataset.label} · \${monthButton.dataset.count} 篇\`
      const list = document.createElement("ul")
      if (titles.length === 0) {
        const item = document.createElement("li")
        item.textContent = "暂无文章"
        list.append(item)
      } else {
        for (const title of titles) {
          const item = document.createElement("li")
          item.textContent = title
          list.append(item)
        }
      }
      tooltip.replaceChildren(heading, list)
      tooltip.hidden = false

      requestAnimationFrame(() => {
        const trigger = monthButton.getBoundingClientRect()
        const tip = tooltip.getBoundingClientRect()
        const left = Math.min(
          window.innerWidth - tip.width / 2 - 12,
          Math.max(tip.width / 2 + 12, trigger.left + trigger.width / 2),
        )
        let top = trigger.top - tip.height - 10
        if (top < 8) top = trigger.bottom + 10
        tooltip.style.left = \`\${left}px\`
        tooltip.style.top = \`\${top}px\`
      })
    }

    const hideTooltip = () => {
      if (tooltip) tooltip.hidden = true
    }

    const monthListeners = []
    for (const monthButton of monthButtons) {
      const activate = () => {
        if (Number(monthButton.dataset.count) > 0) {
          applyMonthFilter(monthButton.dataset.month)
        }
      }
      const enter = () => showTooltip(monthButton)
      monthButton.addEventListener("click", activate)
      monthButton.addEventListener("pointerenter", enter)
      monthButton.addEventListener("pointerleave", hideTooltip)
      monthButton.addEventListener("focus", enter)
      monthButton.addEventListener("blur", hideTooltip)
      monthButton.removeAttribute("title")
      monthListeners.push({ monthButton, activate, enter })
    }

    if (clearFilter) clearFilter.addEventListener("click", clearMonthFilter)
    window.addEventListener("scroll", hideTooltip, { passive: true })

    container.dataset.bound = "true"
    updateStatus()
    window.addCleanup(() => {
      if (button) button.removeEventListener("click", loadMore)
      if (clearFilter) clearFilter.removeEventListener("click", clearMonthFilter)
      window.removeEventListener("scroll", hideTooltip)
      for (const { monthButton, activate, enter } of monthListeners) {
        monthButton.removeEventListener("click", activate)
        monthButton.removeEventListener("pointerenter", enter)
        monthButton.removeEventListener("pointerleave", hideTooltip)
        monthButton.removeEventListener("focus", enter)
        monthButton.removeEventListener("blur", hideTooltip)
      }
      if (observer) observer.disconnect()
    })
  }
}

document.addEventListener("nav", setupRecentNotes)
document.addEventListener("render", setupRecentNotes)
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
    const chartMonths = Math.max(1, Number(options.chartMonths) || defaults.chartMonths)
    const hasMore = pages.length > initialLimit
    const timeline = publicationTimeline(pages, cfg, locale, chartMonths)
    const timelineTotal = timeline.reduce((sum, month) => sum + month.total, 0)
    const maxMonthTotal = Math.max(1, ...timeline.map((month) => month.total))
    const timelineRange = `${timeline.at(0)?.key.replace("-", ".")}—${timeline
      .at(-1)
      ?.key.replace("-", ".")}`
    const timelineDefaultText = `${timelineRange} · 共 ${timelineTotal} 篇`

    const className = [displayClass, "recent-notes", "with-summary"].filter(Boolean).join(" ")

    return h(
      "div",
      {
        class: className,
        "data-recent-notes": "",
        "data-recent-notes-infinite": hasMore ? "" : undefined,
        "data-initial-limit": initialLimit,
        "data-batch-size": batchSize,
      },
      h("h3", null, options.title),
      h(
        "section",
        {
          class: "publication-chart",
          "data-publication-chart": "",
          "aria-label": `近 ${chartMonths} 个月文章数量`,
        },
        h(
          "div",
          { class: "publication-chart__header" },
          h(
            "div",
            null,
            h("p", { class: "publication-chart__eyebrow" }, `过去 ${chartMonths} 个月`),
            h(
              "p",
              {
                class: "publication-chart__status",
                "data-publication-chart-status": "",
                "data-default-text": timelineDefaultText,
                "aria-live": "polite",
              },
              timelineDefaultText,
            ),
          ),
          h(
            "button",
            {
              type: "button",
              class: "publication-chart__clear",
              "data-publication-chart-clear": "",
              hidden: true,
            },
            "查看全部",
          ),
        ),
        h(
          "ul",
          { class: "publication-chart__legend", "aria-label": "文章类型" },
          Object.entries(contentTypes).map(([type, definition]) =>
            h(
              "li",
              { class: `publication-chart__legend-item publication-chart__legend-item--${type}` },
              definition.label,
            ),
          ),
        ),
        h(
          "div",
          { class: "publication-chart__scroll" },
          h(
            "div",
            {
              class: "publication-chart__plot",
              style: `--publication-chart-columns: ${timeline.length}`,
            },
            timeline.map((month, index) => {
              const tooltipText = `${month.label} · ${month.total} 篇\n${
                month.titles.join("\n") || "暂无文章"
              }`
              const height = month.total === 0 ? 0 : (month.total / maxMonthTotal) * 100
              const showAxisLabel = index === 0 || index === timeline.length - 1 || index % 3 === 0

              return h(
                "button",
                {
                  type: "button",
                  class: "publication-chart__month",
                  key: month.key,
                  "data-publication-month": "",
                  "data-month": month.key,
                  "data-label": month.label,
                  "data-count": month.total,
                  "data-titles": JSON.stringify(month.titles),
                  "aria-label": tooltipText,
                  "aria-pressed": "false",
                  "aria-disabled": month.total === 0 ? "true" : undefined,
                  title: tooltipText,
                },
                h(
                  "span",
                  { class: "publication-chart__bar-track", "aria-hidden": "true" },
                  h(
                    "span",
                    {
                      class: "publication-chart__bar",
                      style: `--publication-month-height: ${height}%`,
                    },
                    Object.entries(contentTypes).map(([type]) => {
                      const count = month.counts[type]
                      return count > 0
                        ? h("span", {
                            class: `publication-chart__segment publication-chart__segment--${type}`,
                            style: `--publication-segment-count: ${count}`,
                          })
                        : null
                    }),
                  ),
                ),
                h(
                  "span",
                  {
                    class: `publication-chart__month-label${
                      showAxisLabel ? "" : " publication-chart__month-label--hidden"
                    }`,
                    "aria-hidden": "true",
                  },
                  month.key.replace("-", "."),
                ),
              )
            }),
          ),
        ),
        h("div", {
          class: "publication-chart__tooltip",
          role: "tooltip",
          "data-publication-tooltip": "",
          hidden: true,
        }),
      ),
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
              "data-month": monthKey(date),
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

  Component.afterDOMLoaded = recentNotesScript
  return Component
}

export { RecentNotesSummary }
export default RecentNotesSummary
