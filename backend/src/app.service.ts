import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  register(body: any) {
    // In a real app you'd validate and persist the data.
    return { success: true, received: body };
  }
}
