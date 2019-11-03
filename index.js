const _ = require('lodash');
const express = require('express');
const glob = require('glob');
const path = require('path');
const Promise = require('bluebird');
const filesize = require('filesize');
const chance = require('chance').Chance();
const {
  query, param, validationResult, sanitizeQuery,
} = require('express-validator');
const { isInt, isHexadecimal } = require('validator');
const sizeOf = require('image-size');
const { ensureDirSync, stat } = require('fs-extra');
const debug = require('debug')('album-server');
const cors = require('cors');
const { AUTO, thumbGen } = require('./thumb-gen');

const app = express();
app.use(cors());
const port = 3000;

const STATIC_PATH = path.resolve(process.env.STATIC_PATH || './static');
debug('Static path is ', STATIC_PATH);
ensureDirSync(STATIC_PATH);

const TEMP_PATH = path.resolve(process.env.TEMP_PATH || './temp');
debug('Temp path is ', TEMP_PATH);
ensureDirSync(TEMP_PATH);

const photos = {};
const init = async () => {
  const photosToAdd = _.flatten(await Promise.map(
    [
      'jpg', 'jpeg', 'png', 'gif',
    ],
    (ext) => Promise.promisify(glob)(
      path.join(STATIC_PATH, `**/*.${ext}`),
      { nodir: true },
    ),
  ));
  await Promise.map(photosToAdd, async (p) => {
    const { width, height } = await Promise.promisify(sizeOf)(p);
    const onDisk = (await Promise.promisify(stat)(p)).size;
    const hash = chance.hash();
    photos[hash] = {
      path: p,
      url: `/d/${hash}`,
      thumb: `/thumbs/${hash}`,
      name: path.basename(p),
      size: { width, height, onDisk: filesize(onDisk) },
    };
  });
};

app.get('/photos', [
  query('from').custom((from) => {
    if (from === undefined) return true;
    if (from === '') return true;
    if (isInt(from, { min: 0 })) return true;
    return false;
  }),
  sanitizeQuery('from').customSanitizer((from) => parseInt(from || 0, 10)),
  query('max').custom((max) => {
    if ([undefined, '', '10', '20', '30'].includes(max)) return true;
    return false;
  }),
  sanitizeQuery('max').customSanitizer((max) => parseInt(max || 10, 10)),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }
  const paginatedPhotos = Object.keys(photos).splice(
    req.query.from,
    req.query.max,
  );
  res.send({
    photos: paginatedPhotos,
    pages: Math.ceil(Object.keys(photos).length / req.query.max),
    currentPage: Math.floor(req.query.from / req.query.max),
  });
});

const hashValidator = param('id').custom((id) => {
  if (isHexadecimal(id) && id.length === 40) return true;
  return false;
});

const send404 = (value, res) => res.status(404).json({
  errors: [{
    value,
    msg: 'Not found',
    param: 'id',
    location: 'params',
  }],
});

app.get('/photos/:id', [
  hashValidator,
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }
  if (!photos[req.params.id]) {
    send404(req.params.id, res);
    return;
  }
  const photo = photos[req.params.id];
  res.send({
    name: photo.name,
    size: photo.size,
    thumb: photo.thumb,
    url: photo.url,
  });
});

app.get('/d/:id', [
  hashValidator,
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }
  if (!photos[req.params.id]) {
    send404(req.params.id, res);
    return;
  }
  const photo = photos[req.params.id];
  res.sendFile(photo.path);
});

const sendFile = (res, file, mime) => {
  debug('Send', file);
  res.set('Content-Type', mime);
  res.sendFile(file);
};

app.get('/thumbs/:id', [
  hashValidator,
  query('d').custom((d) => {
    if ([undefined, '', '50', '150', '250'].includes(d)) return true;
    return false;
  }),
  sanitizeQuery('d').customSanitizer((d) => parseInt(d || 50, 10)),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }
  if (!photos[req.params.id]) {
    send404(req.params.id, res);
    return;
  }
  const THUMB_MIME = 'image/jpeg';


  const photo = photos[req.params.id];
  if (photo.thumbPath) {
    sendFile(res, photo.thumbPath, THUMB_MIME);
    return;
  }

  const { size: { width, height } } = photo;
  debug(photo.path, width, height);
  const THUMB_DIM = req.query.d;
  if (width <= THUMB_DIM && height <= THUMB_DIM) {
    photo.thumbPath = photo.path;
    sendFile(res, photo.thumbPath, THUMB_MIME);
    return;
  }

  debug('Use imageMagick to scale down image.');
  const thumbPath = path.join(TEMP_PATH, chance.hash());
  if (width > height) {
    await thumbGen({
      width: THUMB_DIM, height: AUTO, src: photo.path, out: thumbPath, debug,
    });
  } else {
    await thumbGen({
      width: AUTO, height: THUMB_DIM, src: photo.path, out: thumbPath, debug,
    });
  }
  photo.thumbPath = thumbPath;
  sendFile(res, photo.thumbPath, THUMB_MIME);
});


const ui = express();
ui.use(cors());
const uiPort = 3001;
ui.use('/app/static', express.static('ui/static'));
ui.get('/app/photos/*', (req, res) => {
  res.sendFile(path.resolve('ui/index.html'));
});
ui.listen(uiPort, () => debug(`UI listening on port ${uiPort}!`));

init().then(() => app.listen(port, () => debug(`Server listening on port ${port}!`)));
