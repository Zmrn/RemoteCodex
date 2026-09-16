// Two solid frames, generated without a codec dependency or private user media.
export function animatedGif() {
  const chunks = [Buffer.from('GIF89a', 'ascii'), Buffer.from([64,0,40,0,128,0,0, 232,70,70, 45,170,220]),
    Buffer.from([33,255,11]), Buffer.from('NETSCAPE2.0'), Buffer.from([3,1,0,0,0])];
  for (const color of [0,1]) {
    chunks.push(Buffer.from([33,249,4,0,40,0,0,0, 44,0,0,0,0,64,0,40,0,0, 2]));
    const packed=[]; let bits=0, count=0;
    const code=n=>{bits|=n<<count;count+=3;while(count>=8){packed.push(bits&255);bits>>=8;count-=8;}};
    for(let i=0;i<64*40;i++){code(4);code(color);} code(5);if(count)packed.push(bits&255);
    for(let i=0;i<packed.length;i+=255){const block=Buffer.from(packed.slice(i,i+255));chunks.push(Buffer.from([block.length]),block);}
    chunks.push(Buffer.from([0]));
  }
  return Buffer.concat([...chunks,Buffer.from([59])]);
}
