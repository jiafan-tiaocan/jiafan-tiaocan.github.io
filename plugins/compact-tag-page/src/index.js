import { h } from "preact"
import { formatDate } from "@quartz-community/utils/date"
import { getDate } from "@quartz-community/utils/sort"
import {
  getAllSegmentPrefixes,
  joinSegments,
  resolveRelative,
  slugTag,
} from "@quartz-community/utils/path"

function listedPages(allFiles) {
  return allFiles.filter((page) => page.unlisted !== true && Array.isArray(page.frontmatter?.tags))
}

function collectTags(allFiles, locale = "zh-CN") {
  const counts = new Map()

  for (const page of listedPages(allFiles)) {
    const pageTags = new Set((page.frontmatter?.tags ?? []).flatMap(getAllSegmentPrefixes))
    for (const tag of pageTags) {
      const slug = slugTag(tag)
      const entry = counts.get(slug)
      if (entry) {
        entry.count += 1
      } else {
        counts.set(slug, { name: tag, slug, count: 1 })
      }
    }
  }

  return [...counts.values()].sort((left, right) => left.name.localeCompare(right.name, locale))
}

function pagesForTag(allFiles, tagSlug) {
  return listedPages(allFiles).filter((page) => {
    const pageTags = [...new Set((page.frontmatter?.tags ?? []).flatMap(getAllSegmentPrefixes))]
    return pageTags.some((tag) => slugTag(tag) === tagSlug)
  })
}

function pageDate(page, cfg) {
  if (!page.dates) return undefined
  return getDate({
    ...page,
    defaultDateType: page.defaultDateType ?? cfg.defaultDateType,
  })
}

function TagIndex({ tags, currentSlug }) {
  return h(
    "section",
    { class: "tag-index", "aria-labelledby": "tag-index-description" },
    h(
      "p",
      { id: "tag-index-description", class: "tag-index__description" },
      `按名称浏览全部 ${tags.length} 个标签，右上角数字为相关文章数量。`,
    ),
    h(
      "ul",
      { class: "tag-cloud tag-cloud--index" },
      tags.map((tag) =>
        h(
          "li",
          { key: tag.slug },
          h(
            "a",
            {
              class: "internal tag-cloud__link",
              href: resolveRelative(currentSlug, `tags/${tag.slug}`),
            },
            h("span", { class: "tag-cloud__name" }, tag.name),
            h("sup", { class: "tag-cloud__count" }, tag.count),
          ),
        ),
      ),
    ),
  )
}

function TagArticleList({ pages, currentSlug, cfg }) {
  const locale = cfg.locale || "zh-CN"
  const sortedPages = [...pages].sort((left, right) => {
    const dateDifference =
      (pageDate(right, cfg)?.getTime() ?? 0) - (pageDate(left, cfg)?.getTime() ?? 0)
    if (dateDifference !== 0) return dateDifference
    return String(left.frontmatter?.title ?? "").localeCompare(
      String(right.frontmatter?.title ?? ""),
      locale,
    )
  })

  return h(
    "ul",
    { class: "tag-detail__articles" },
    sortedPages.map((page) => {
      const date = pageDate(page, cfg)
      return h(
        "li",
        { key: page.slug },
        h(
          "div",
          { class: "tag-detail__article" },
          h(
            "h2",
            null,
            h(
              "a",
              { class: "internal", href: resolveRelative(currentSlug, page.slug) },
              page.frontmatter?.title ?? "Untitled",
            ),
          ),
          date && h("time", { datetime: date.toISOString() }, formatDate(date, locale)),
        ),
      )
    }),
  )
}

function createCompactTagContent() {
  function TagContent({ allFiles, cfg, fileData }) {
    const currentSlug = fileData.slug
    const isIndex = currentSlug === "tags" || currentSlug === "tags/index"
    const tags = collectTags(allFiles, cfg.locale || "zh-CN")

    if (isIndex) {
      return h("div", { class: "popover-hint tag-index-page" }, h(TagIndex, { tags, currentSlug }))
    }

    const tagSlug = currentSlug.slice("tags/".length)
    const pages = pagesForTag(allFiles, tagSlug)

    return h(
      "div",
      { class: "popover-hint tag-detail" },
      h("p", { class: "tag-detail__summary" }, `共 ${pages.length} 篇相关文章。`),
      h(TagArticleList, { pages, currentSlug, cfg }),
      h(
        "p",
        { class: "tag-detail__back" },
        h(
          "a",
          { class: "internal", href: resolveRelative(currentSlug, "tags/index") },
          "返回全部标签",
        ),
      ),
    )
  }

  return TagContent
}

function TagPage() {
  return {
    name: "TagPage",
    priority: 10,
    match: ({ slug }) => slug === "tags" || slug.startsWith("tags/"),
    generate({ content, cfg }) {
      const allFiles = content.map((entry) => entry[1].data)
      const tags = collectTags(allFiles, cfg.locale || "zh-CN")
      const existingSlugs = new Set(
        allFiles.map((file) => file.slug).filter((slug) => slug?.startsWith("tags/")),
      )
      const virtualPages = []

      if (!existingSlugs.has("tags/index")) {
        virtualPages.push({ slug: "tags/index", title: "标签索引", data: {} })
      }

      for (const tag of tags) {
        const slug = joinSegments("tags", tag.slug)
        if (existingSlugs.has(slug)) continue
        virtualPages.push({ slug, title: tag.name, data: {} })
      }

      return virtualPages
    },
    layout: "tag",
    body: createCompactTagContent,
  }
}

export { TagPage }
export default TagPage
