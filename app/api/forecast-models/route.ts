import {
  handleModelsGet,
  handleModelsPost,
} from '@/lib/forecast-multimodel-server';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 180;
export const GET = () => handleModelsGet();
export const POST = (request: Request) => handleModelsPost(request);
