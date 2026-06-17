const express = require("express");
const ejs = require("ejs");
const cookieParser = require("cookie-parser");

const app = express();
const port = 80;

app.engine("ejs", ejs.renderFile);
app.use("/static", express.static("static"));
app.use(cookieParser());

//
// ROUTES
//

app.get("/", (req, res) => {
  res.render("home.ejs", { theme: req.cookies.theme || "light" });
});

//
// NON-ROUTES
//

// Unmatched routes -> 404
app.use((req, res, next) => {
  const err = new Error("Not Found");
  err.code = 404;
  next(err);
});

// Error handler (must be last)
app.use((err, req, res, next) => {
  const code = err.code || 500;
  const msg = err.message || "Internal Server Error";
  if (code != 404) console.error(err.stack);
  res.status(code).render("error.ejs", {
    code: code,
    msg: msg,
    theme: req.cookies.theme || "light",
  });
});

app.listen(port, () => {
  console.log(`Running on port ${port}`);
});
