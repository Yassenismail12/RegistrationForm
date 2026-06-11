import { Controller, Get, Post, Body } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getRoot() {
    return { ok: true };
  }

  @Post('register')
  register(@Body() body: any) {
    return this.appService.register(body);
  }
}
