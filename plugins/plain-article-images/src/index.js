const comparisonBase = "https://quartz.local/current/"

function normalizedResourceUrl(value) {
  if (typeof value !== "string" || value.length === 0) return null

  try {
    const url = new URL(value, comparisonBase)
    url.hash = ""
    return url.href
  } catch {
    return null
  }
}

function isSelfLinkedImage(node) {
  if (node?.type !== "element" || node.tagName !== "a") return false
  if (node.children?.length !== 1) return false

  const image = node.children[0]
  if (image?.type !== "element" || image.tagName !== "img") return false

  const href = normalizedResourceUrl(node.properties?.href)
  const src = normalizedResourceUrl(image.properties?.src)
  return href !== null && href === src
}

function unwrapSelfLinkedImages(node) {
  if (!Array.isArray(node?.children)) return

  node.children = node.children.flatMap((child) => {
    if (isSelfLinkedImage(child)) return child.children

    unwrapSelfLinkedImages(child)
    return [child]
  })
}

function PlainArticleImages() {
  return {
    name: "PlainArticleImages",
    htmlPlugins() {
      return [
        () => (tree) => {
          unwrapSelfLinkedImages(tree)
        },
      ]
    },
  }
}

export { PlainArticleImages, isSelfLinkedImage, unwrapSelfLinkedImages }
export default PlainArticleImages
