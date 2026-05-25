interface GeminiDetection {
  label: string;
  description?: string;
  confidence: number;
  bbox: [number, number, number, number];
}

interface GeminiResponse {
  detections?: GeminiDetection[];
  scene_summary?: string;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const ADE20K_COLORS: Record<string, string> = {
  building: '#FF6B6B',
  tree: '#4CAF50',
  grass: '#8BC34A',
  water: '#2196F3',
  road: '#9E9E9E',
  car: '#FF9800',
  sidewalk: '#795548',
  vegetation: '#33691E',
  fence: '#BDBDBD',
  sky: '#87CEEB',
};

const colorAliases: Array<[RegExp, keyof typeof ADE20K_COLORS]> = [
  [/\b(building|roof|rooftop|house|residential)\b/i, 'building'],
  [/\b(tree|palm)\b/i, 'tree'],
  [/\b(grass|lawn|field)\b/i, 'grass'],
  [/\b(water|river|canal|pond|lake)\b/i, 'water'],
  [/\b(road|street|lane|path)\b/i, 'road'],
  [/\b(car|vehicle|truck|bus|van)\b/i, 'car'],
  [/\b(sidewalk|footpath|walkway|pavement)\b/i, 'sidewalk'],
  [/\b(vegetation|greenery|shrub|bush)\b/i, 'vegetation'],
  [/\b(fence|boundary|wall)\b/i, 'fence'],
  [/\b(sky|cloud)\b/i, 'sky'],
];

const fallbackColor = (label: string): string => {
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = ((hash << 5) - hash + label.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 68% 55%)`;
};

const colorForLabel = (label: string): string => {
  const normalized = label.trim().toLowerCase();
  if (ADE20K_COLORS[normalized]) {
    return ADE20K_COLORS[normalized];
  }
  for (const [pattern, colorKey] of colorAliases) {
    if (pattern.test(normalized)) {
      return ADE20K_COLORS[colorKey];
    }
  }
  return fallbackColor(normalized);
};

const toPixelBBox = (
  bbox: number[] | undefined,
  width: number,
  height: number
): [number, number, number, number] => {
  if (!bbox || bbox.length < 4) {
    return [0, 0, 0, 0];
  }
  const x1 = clamp((bbox[0] / 1000) * width, 0, width);
  const y1 = clamp((bbox[1] / 1000) * height, 0, height);
  const x2 = clamp((bbox[2] / 1000) * width, 0, width);
  const y2 = clamp((bbox[3] / 1000) * height, 0, height);
  return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
};

export const analyzeImageWithGemini = async (
  imageBase64: string,
  model: string = 'gemini-2.5-flash',
  width: number = 2048,
  height: number = 1534
) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Gemini API key is not configured. Please set GEMINI_API_KEY in your environment variables.');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const payload = {
    contents: [
      {
        parts: [
          {
            text: `Analyze this drone aerial image. Return ONLY valid JSON (no markdown, no explanation) with:
            {
              "detections": [
                {
                  "label": "<class name>",
                  "description": "<brief description>",
                  "confidence": <float 0.0-1.0>,
                  "bbox": [x1, y1, x2, y2]
                }
              ],
              "scene_summary": "<overall description>"
            }
            Use bbox coordinates normalized to 0-1000 where x1,y1 is top-left and x2,y2 is bottom-right.
            Identify buildings, rooftops, trees, vegetation, roads, water bodies, open ground, and vehicles.`
          },
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: imageBase64
            }
          }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          detections: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                label: { type: 'STRING' },
                description: { type: 'STRING' },
                confidence: { type: 'NUMBER' },
                bbox: {
                  type: 'ARRAY',
                  items: { type: 'NUMBER' }
                }
              },
              required: ['label', 'confidence', 'bbox']
            }
          },
          scene_summary: { type: 'STRING' }
        },
        required: ['detections']
      }
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textContent) {
    throw new Error('Empty response from Gemini API');
  }

  const parsed = JSON.parse(textContent) as GeminiResponse;
  const rawDetections = Array.isArray(parsed.detections) ? parsed.detections : [];

  const detections = rawDetections.map((detection) => {
    const bbox = toPixelBBox(detection.bbox, width, height);
    const pixelArea = Math.max(0, Math.round((bbox[2] - bbox[0]) * (bbox[3] - bbox[1])));

    return {
      ...detection,
      bbox,
      pixel_area: pixelArea,
      color: colorForLabel(detection.label ?? 'unknown'),
    };
  });

  return { ...parsed, detections };
};
