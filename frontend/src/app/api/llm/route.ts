import { NextRequest, NextResponse } from 'next/server';
import { analyzeImageWithGemini } from '@/lib/gemini';

const GEMINI_MODELS = new Set(['gemini-2.5-flash']);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const image_base64 = body.image_base64 || body.image_base_64;
    const model = typeof body.model === 'string' ? body.model : 'gemini-2.5-flash';
    const width = Number(body.width) > 0 ? Number(body.width) : 2048;
    const height = Number(body.height) > 0 ? Number(body.height) : 1534;

    if (!image_base64) {
      return NextResponse.json({ error: 'Image data is required' }, { status: 400 });
    }
    if (!GEMINI_MODELS.has(model)) {
      return NextResponse.json({ error: `Unsupported model '${model}'` }, { status: 400 });
    }

    const results = await analyzeImageWithGemini(image_base64, model, width, height);
    return NextResponse.json(results);
  } catch (error: unknown) {
    console.error('LLM Analysis Error:', error);
    const errMsg = error instanceof Error ? error.message : 'Analysis failed';
    const status = errMsg.toLowerCase().includes('not configured') ? 503 : 500;
    return NextResponse.json({ error: errMsg }, { status });
  }
}
