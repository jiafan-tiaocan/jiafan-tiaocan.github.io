import { loadQuartzConfig, loadQuartzLayout } from "./quartz/plugins/loader/config-loader"
import * as ExternalPlugin from "./.quartz/plugins"

ExternalPlugin.RecentNotes({
  filter: (page: { slug?: string; frontmatter?: { publish?: boolean } }) =>
    page.slug !== "404" && page.frontmatter?.publish === true,
})

const config = await loadQuartzConfig()
export default config
export const layout = await loadQuartzLayout()
