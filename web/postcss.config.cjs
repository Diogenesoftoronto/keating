module.exports = {
  plugins: [
    require("@pandacss/dev/postcss")(),
    // After Panda, so the cursor utilities it generates are rewritten too.
    require("./scripts/postcss-keating-cursors.cjs")(),
  ],
};
