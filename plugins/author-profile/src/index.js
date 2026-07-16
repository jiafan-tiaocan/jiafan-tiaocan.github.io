import { h } from "preact"

function AuthorProfile() {
  function Component({ displayClass }) {
    const className = [displayClass, "author-profile"].filter(Boolean).join(" ")

    return h(
      "aside",
      { class: className, "aria-label": "作者简介" },
      h("p", { class: "author-profile__label" }, "ABOUT"),
      h("p", null, "调参是作者在蚂蚁的花名。"),
      h(
        "p",
        { class: "author-profile__fields" },
        "AIGC、智能体、具身智能、推荐与用户增长、全栈工程师、量化交易。",
      ),
      h("p", null, "还有很多爱好，希望可以保持深度思考，欢迎沟通。"),
      h(
        "a",
        { class: "author-profile__email", href: "mailto:jiafan.jf@qq.com" },
        "jiafan.jf@qq.com",
      ),
    )
  }

  return Component
}

export { AuthorProfile }
export default AuthorProfile
