import { h } from "preact"
import { getAllSegmentPrefixes, resolveRelative, slugTag } from "@quartz-community/utils/path"

const defaults = {
  title: "热门标签",
  limit: 20,
}

function collectTags(allFiles, locale) {
  const counts = new Map()

  for (const page of allFiles) {
    if (page.unlisted === true) continue

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

  return [...counts.values()].sort(
    (left, right) => right.count - left.count || left.name.localeCompare(right.name, locale),
  )
}

function renderTagList(tags, currentSlug, className) {
  return h(
    "ul",
    { class: className },
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
  )
}

const tagCloudScript = `
const setupHomeTagCloud = () => {
  for (const button of document.querySelectorAll("[data-home-tag-toggle]")) {
    if (button.dataset.bound === "true") continue

    const targetId = button.getAttribute("aria-controls")
    const target = targetId ? document.getElementById(targetId) : null
    if (!target) continue

    const toggleTags = () => {
      const expanded = button.getAttribute("aria-expanded") === "true"
      button.setAttribute("aria-expanded", String(!expanded))
      target.hidden = expanded
      button.textContent = expanded ? "显示更多" : "收起标签"
    }

    button.dataset.bound = "true"
    button.addEventListener("click", toggleTags)
    window.addCleanup(() => button.removeEventListener("click", toggleTags))
  }
}

document.addEventListener("nav", setupHomeTagCloud)
document.addEventListener("render", setupHomeTagCloud)
`

function HomeTagCloud(userOptions = {}) {
  const options = { ...defaults, ...userOptions }

  function Component({ allFiles, cfg, displayClass, fileData }) {
    const locale = cfg.locale || "zh-CN"
    const tags = collectTags(allFiles, locale)
    const visibleTags = tags.slice(0, options.limit)
    const remainingTags = tags.slice(options.limit)
    const extraId = "home-tag-cloud-extra"
    const className = [displayClass, "home-tag-cloud"].filter(Boolean).join(" ")

    if (tags.length === 0) return null

    return h(
      "section",
      { class: className, "aria-labelledby": "home-tag-cloud-title" },
      h(
        "div",
        { class: "home-tag-cloud__header" },
        h("h3", { id: "home-tag-cloud-title" }, options.title),
        h("p", null, "按文章数量排序"),
      ),
      renderTagList(visibleTags, fileData.slug, "tag-cloud tag-cloud--home"),
      remainingTags.length > 0 &&
        h(
          "div",
          { id: extraId, class: "home-tag-cloud__extra", hidden: true },
          renderTagList(remainingTags, fileData.slug, "tag-cloud tag-cloud--home"),
        ),
      h(
        "div",
        { class: "home-tag-cloud__actions" },
        remainingTags.length > 0 &&
          h(
            "button",
            {
              type: "button",
              "data-home-tag-toggle": "",
              "aria-controls": extraId,
              "aria-expanded": "false",
            },
            "显示更多",
          ),
        h(
          "a",
          {
            class: "internal home-tag-cloud__all",
            href: resolveRelative(fileData.slug, "tags/index"),
          },
          `浏览全部 ${tags.length} 个标签`,
        ),
      ),
    )
  }

  Component.afterDOMLoaded = tagCloudScript
  return Component
}

export { HomeTagCloud }
export default HomeTagCloud
