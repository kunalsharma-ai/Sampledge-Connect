import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import type { TenantContext } from '../common/tenant-context.js';
import { AuthGuard, Ctx } from '../auth/auth.guard.js';
import { RateLimitService } from '../redis/redis.module.js';
import { ApprovalsService } from './approvals.service.js';
import { ProjectsService } from './projects.service.js';
import { TasksService } from './tasks.service.js';

/** Tasks, approvals and projects (docs/work.md). */
@Controller('v1')
@UseGuards(AuthGuard)
export class WorkController {
  constructor(
    private readonly tasks: TasksService,
    private readonly approvals: ApprovalsService,
    private readonly projects: ProjectsService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Get('tasks')
  listTasks(@Ctx() ctx: TenantContext, @Query() q: unknown) {
    return this.tasks.list(ctx, q);
  }
  @Post('tasks')
  async createTask(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    await this.rateLimit.consume('api_user', ctx.userId);
    return this.tasks.create(ctx, body);
  }
  @Get('tasks/:id')
  getTask(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.tasks.get(ctx, id);
  }
  @Patch('tasks/:id')
  updateTask(@Ctx() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.tasks.update(ctx, id, body);
  }

  @Get('approvals')
  listApprovals(@Ctx() ctx: TenantContext, @Query() q: unknown) {
    return this.approvals.list(ctx, q);
  }
  @Post('approvals')
  async createApproval(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    await this.rateLimit.consume('api_user', ctx.userId);
    return this.approvals.create(ctx, body);
  }
  @Get('approvals/:id')
  getApproval(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.approvals.get(ctx, id);
  }
  @Post('approvals/:id/decision')
  @HttpCode(200)
  decide(@Ctx() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.approvals.decide(ctx, id, body);
  }
  @Post('approvals/:id/cancel')
  @HttpCode(200)
  cancel(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.approvals.cancel(ctx, id);
  }

  @Get('projects')
  listProjects(@Ctx() ctx: TenantContext) {
    return this.projects.list(ctx);
  }
  @Post('projects')
  createProject(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.projects.create(ctx, body);
  }
  @Get('projects/:id')
  getProject(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.projects.get(ctx, id);
  }
}
