var $ = function (id) {
  return document.getElementById(id);
};

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(";").shift();
}

function themeRefresh() {
  let theme = getCookie("theme") || "light";
  document.body.className = theme;
  $("toggletheme").textContent = theme == "light" ? "☀︎" : "⏾";
}

function toggleTheme() {
  let theme = getCookie("theme") || "light";
  theme = theme == "light" ? "dark" : "light";
  document.cookie = "theme=" + theme;
  themeRefresh();
}

addEventListener("DOMContentLoaded", (event) => {
  themeRefresh();
  $("toggletheme").addEventListener("click", (event) => {
    toggleTheme();
  });
});
