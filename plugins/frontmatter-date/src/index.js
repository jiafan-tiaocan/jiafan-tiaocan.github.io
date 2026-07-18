const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/

function isPublished(frontmatter) {
  return frontmatter?.publish === true || frontmatter?.publish === "true"
}

function normalizeDate(rawDate) {
  if (rawDate instanceof Date && !Number.isNaN(rawDate.getTime())) {
    return rawDate.toISOString().slice(0, 10)
  }

  if (typeof rawDate === "string") return rawDate.trim()
  return ""
}

function parseDate(rawDate, relativePath) {
  const value = normalizeDate(rawDate)
  if (!isoDatePattern.test(value)) {
    throw new Error(`Frontmatter date in ${relativePath} must use YYYY-MM-DD`)
  }

  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`Frontmatter date in ${relativePath} is not a valid calendar date`)
  }

  return date
}

function FrontmatterDate() {
  return {
    name: "FrontmatterDate",
    markdownPlugins() {
      return [
        () => (_tree, file) => {
          const data = file.data
          const frontmatter = data.frontmatter
          const rawDate = frontmatter?.date

          if (rawDate === undefined || rawDate === null || rawDate === "") {
            if (isPublished(frontmatter)) {
              throw new Error(
                `Published note ${data.relativePath ?? data.filePath} must define frontmatter date`,
              )
            }
            return
          }

          const date = parseDate(rawDate, data.relativePath ?? data.filePath ?? "unknown note")

          // Quartz expects all date slots when date metadata exists. They intentionally
          // share one value: this blog exposes a single author-controlled display date.
          data.dates = {
            created: date,
            modified: date,
            published: date,
          }
          data.defaultDateType = "published"
        },
      ]
    },
  }
}

export { FrontmatterDate }
export default FrontmatterDate
