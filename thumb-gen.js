const { spawn } = require('child_process');

module.exports = {
  AUTO: 'AUTO RESIZE ONE DIMENSION',
  thumbGen: function thumbGen({
    width, height, src, out, debug,
  }) {
    let size = `${width}x${height}`;
    if (width === module.exports.AUTO) {
      size = `x${height}`;
    } else if (height === this.auto) {
      size = `${width}x`;
    }
    const args = [
      '-thumbnail',
      size,
      src,
      out,
    ];
    if (debug) debug(args);
    return new Promise((r, reject) => {
      const imageMagick = spawn('convert', args);
      imageMagick.on('close', (code) => (code === 0 ? r() : reject(code)));
    });
  },
};
