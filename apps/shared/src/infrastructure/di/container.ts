export function setupDependencies() {
  const container = Container.getInstance();

  // Database
  container.register('Database', () => createDatabase());
  
  // Repositories
  container.register('TrackRepository', () => 
    new DrizzleTrackRepository(container.resolve('Database'))
  );

  // Services
  container.register('TrackCacheService', () => 
    new TrackCacheService(container.resolve('TrackRepository'))
  );

  // Use Cases (shared)
  container.register('DownloadTrackUseCase', () => 
    new DownloadTrackUseCase(
      container.resolve('TrackCacheService'),
      container.resolve('TrackDownloader'),
      container.resolve('TrackRepository'),
      container.resolve('MessageBus')
    )
  );

  // Use Cases (bot specific)
  container.register('HandleCommandUseCase', () => 
    new HandleCommandUseCase(
      container.resolve('DownloadTrackUseCase'),
      container.resolve('MessageBus')
    )
  );

  // Controllers
  container.register('BotController', () => 
    new BotController(container.resolve('HandleCommandUseCase'))
  );
}
