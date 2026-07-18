import { h } from "preact"
import { formatDate } from "@quartz-community/utils/date"
import { getDate } from "@quartz-community/utils/sort"
import { resolveRelative, slugTag } from "@quartz-community/utils/path"

const defaults = {
  title: "最近写下的",
  limit: 6,
  showTags: true,
  excerptLength: 120,
}

const thoughtCardTones = ["sage", "amber", "coral", "sky"]

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

function thoughtCardTone(page) {
  const slug = Array.from(String(page.slug ?? ""))
  const hash = slug.reduce((value, character) => (value * 31 + character.codePointAt(0)) >>> 0, 0)
  return thoughtCardTones[hash % thoughtCardTones.length]
}

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
      .slice(0, options.limit)

    const className = [displayClass, "recent-notes", "with-summary"].filter(Boolean).join(" ")

    return h(
      "div",
      { class: className },
      h("h3", null, options.title),
      h(
        "ul",
        { class: "recent-ul" },
        pages.map((page) => {
          const title = page.frontmatter?.title ?? "Untitled"
          const tags = page.frontmatter?.tags ?? []
          const date = pageDate(page, cfg)
          const summary = excerptFor(page, options.excerptLength)
          const isThoughtCard = page.frontmatter?.noteType === "thought"
          const itemClass = [
            "recent-li",
            isThoughtCard && "thought-card",
            isThoughtCard && `thought-card--${thoughtCardTone(page)}`,
          ]
            .filter(Boolean)
            .join(" ")

          return h(
            "li",
            { class: itemClass, key: page.slug },
            h(
              "div",
              { class: "section" },
              h(
                "div",
                { class: "desc" },
                isThoughtCard && h("span", { class: "thought-card__label" }, "思考卡片"),
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
    )
  }

  return Component
}

export { RecentNotesSummary }
export default RecentNotesSummary
