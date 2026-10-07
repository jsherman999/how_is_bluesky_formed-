// Records the canvas (plus the AudioHub's sound, when there is any) into a
// video file with MediaRecorder.

const TYPES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  return TYPES.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

export class Recorder {
  constructor() {
    this.rec = null;
    this.chunks = [];
  }

  get active() {
    return !!this.rec && this.rec.state !== 'inactive';
  }

  start(canvas, audioStream) {
    const mime = pickMime();
    if (mime === null) throw new Error('This browser cannot record video.');
    const stream = canvas.captureStream(30);
    if (audioStream) for (const t of audioStream.getAudioTracks()) stream.addTrack(t);
    this.mime = mime || 'video/webm';
    this.chunks = [];
    this.rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: 6_000_000 });
    this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.rec.start(1000);
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.rec || this.rec.state === 'inactive') return resolve(null);
      this.rec.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.mime.split(';')[0] });
        this.rec = null;
        this.chunks = [];
        resolve(blob);
      };
      this.rec.stop();
    });
  }

  get extension() {
    return /mp4/.test(this.mime || '') ? 'mp4' : 'webm';
  }
}
