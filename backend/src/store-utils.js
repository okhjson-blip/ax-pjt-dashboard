function uid(prefix) {
  return prefix + Math.random().toString(36).slice(2, 8);
}

module.exports = { uid };
