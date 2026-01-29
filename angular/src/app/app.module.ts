import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';

import { AppComponent } from './app.component';
import { PresetsListComponent } from './presets-list/presets-list.component';
import { CreateSamplerComponent } from './create-sampler/create-sampler.component';
import { ModifySamplerComponent } from './modify-sampler/modify-sampler.component';

const routes: Routes = [
  { path: '', component: PresetsListComponent },
  { path: 'createsampler', component: CreateSamplerComponent },
  { path: 'modifysampler/:name', component: ModifySamplerComponent },
  { path: '**', redirectTo: '' }
];

@NgModule({
  declarations: [AppComponent, PresetsListComponent, CreateSamplerComponent, ModifySamplerComponent],
  imports: [BrowserModule, HttpClientModule, FormsModule, RouterModule.forRoot(routes)],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule {}
