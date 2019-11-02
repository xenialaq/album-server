const _ = require('lodash');
const express = require('express');
const glob = require('glob');
const path = require('path');
const Promise = require('bluebird');
const chance = require('chance').Chance();
const {
  query, param, validationResult, sanitizeQuery,
} = require('express-validator');
const { isInt, isHexadecimal } = require('validator');
const jimp = require('jimp');
const sizeOf = require('image-size');

const debug = require('debug')('album-server');

const app = express();
const port = 3000;

const STATIC_PATH = path.resolve(process.env.STATIC_PATH || './static');

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
  photosToAdd.forEach((p) => {
    const hash = chance.hash();
    photos[hash] = {
      path: p,
      url: `/d/${hash}`,
      thumb: `/thumbs/${hash}`,
      name: path.basename(p),
    };
  });
};
init();

// respond with "hello world" when a GET request is made to the homepage
app.get('/', (req, res) => {
  res.send('hello world');
});

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
  res.send(paginatedPhotos);
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
  const photo = photos[req.params.id];
  const { width, height } = await Promise.promisify(sizeOf)(photo.path);
  debug(photo.path, width, height);
  const THUMB_DIM = req.query.d;
  if (width <= THUMB_DIM && height <= THUMB_DIM) {
    debug('Send original image as thumb.');
    res.sendFile(photo.path);
    return;
  }
  debug('Use jimp to scale down image.');
  const image = await jimp.read(photo.path);
  if (width > height) {
    image.resize(THUMB_DIM, jimp.AUTO);
  } else {
    image.resize(jimp.AUTO, THUMB_DIM);
  }
  const THUMB_MIME = 'image/jpeg';
  res.set('Content-Type', THUMB_MIME);
  res.send(await image.getBufferAsync(THUMB_MIME));
});


app.listen(port, () => debug(`Example app listening on port ${port}!`));
