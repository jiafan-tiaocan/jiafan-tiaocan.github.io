import { h } from "preact"
import { formatDate } from "@quartz-community/utils/date"
import { getDate } from "@quartz-community/utils/sort"

function countWords(text) {
  const hanCharacters = text.match(/\p{Script=Han}/gu)?.length ?? 0
  const nonHanText = text.replace(/\p{Script=Han}/gu, " ")
  const nonHanWords = nonHanText.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0

  return hanCharacters + nonHanWords
}

function ContentStats() {
  function Component({ cfg, fileData, displayClass }) {
    const text = fileData.text
    if (!text) return null

    const locale = cfg.locale || "zh-CN"
    const defaultDateType = fileData.defaultDateType ?? cfg.defaultDateType
    const date = defaultDateType ? getDate({ ...fileData, defaultDateType }) : undefined
    const wordCount = new Intl.NumberFormat(locale).format(countWords(text))
    const className = [displayClass, "content-meta"].filter(Boolean).join(" ")

    return h(
      "p",
      { class: className },
      date && h("time", { datetime: date.toISOString() }, formatDate(date, locale)),
      date && h("span", { "aria-hidden": "true" }, " · "),
      h("span", null, `${wordCount} 字`),
    )
  }

  return Component
}

export { ContentStats }
export default ContentStats
